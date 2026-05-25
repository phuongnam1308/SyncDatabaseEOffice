const dbConnection = require('../db/connection');
const logger = require('../utils/logger');
const sql = require('mssql');

class BaseModel {
  constructor() {
    this.oldPool = null;
    this.newPool = null;
  }

  // Khởi tạo kết nối - SỬA LẠI: Không throw lỗi nếu database nguồn bị die
  async initialize() {
    try {
      await dbConnection.connectAll();
      this.oldPool = dbConnection.getOldPool(); // Có thể là null nếu chết server
      this.newPool = dbConnection.getNewPool(); // Có thể là null
    } catch (error) {
      logger.error('Lỗi khởi tạo BaseModel (tiếp tục app):', error.message);
      // Không throw tiếp để các model khác vẫn được khởi tạo (cho dashboard)
    }
  }

  // Query từ database cũ
  async queryOldDb(query, params = {}) {
    try {
      if (!this.oldPool) {
        throw new Error('Chưa kết nối được Database CŨ (Nguồn). Vui lòng kiểm tra lại cấu hình OLD_DB_* trong file .env.');
      }
      const request = this.oldPool.request();

      // Bind parameters
      this._bindParams(request, params);

      const result = await request.query(query);
      return result.recordset;
    } catch (error) {
      logger.error(`Lỗi query database cũ: ${error.message}. Query: ${query.substring(0, 500)}. Params: ${JSON.stringify(params)}`);
      throw error;
    }
  }

  // Query từ database mới
  async queryNewDb(query, params = {}) {
    try {
      if (!this.newPool) {
        throw new Error('Lỗi: Chưa kết nối được Database MỚI (Đích). Không thể ghi dữ liệu.');
      }
      const request = this.newPool.request();
      const requestTimeout = parseInt(process.env.DB_REQUEST_TIMEOUT_MS || process.env.NEW_DB_REQUEST_TIMEOUT_MS || '120000', 10);
      if (!Number.isNaN(requestTimeout)) {
        request.timeout = requestTimeout;
      }

      // Bind parameters
      this._bindParams(request, params);

      const result = await request.query(query);
      return result.recordset;
    } catch (error) {
      logger.error(`Lỗi query database mới: ${error.message}. Query: ${query.substring(0, 500)}. Params: ${JSON.stringify(params)}`);
      throw error;
    }
  }

  async queryNewDbTx(query, params = {}, transaction = null) {
    try {
      const canUseTransaction = Boolean(
        transaction &&
        transaction._acquiredConnection &&
        !transaction._aborted
      );

      if (!canUseTransaction) {
        if (!this.newPool) {
          throw new Error('Lỗi: Chưa kết nối được Database MỚI (Đích). Không thể ghi dữ liệu.');
        }
      }

      const request = canUseTransaction
        ? new sql.Request(transaction)
        : this.newPool.request();
      const requestTimeout = parseInt(process.env.DB_REQUEST_TIMEOUT_MS || process.env.NEW_DB_REQUEST_TIMEOUT_MS || '120000', 10);
      if (!Number.isNaN(requestTimeout)) {
        request.timeout = requestTimeout;
      }

      this._bindParams(request, params);

      const result = await request.query(query);
      return result.recordset;
    } catch (error) {
      logger.error(`Lỗi query database mới (TX): ${error.message}. Query: ${query.substring(0, 500)}. Params: ${JSON.stringify(params)}`);
      throw error;
    }
  }

  async executeNewDb(query, params = {}) {
    try {
      if (!this.newPool) {
        throw new Error('Lỗi: Chưa kết nối được Database MỚI (Đích). Không thể ghi dữ liệu.');
      }
      const request = this.newPool.request();

      // Bind parameters
      this._bindParams(request, params);

      const result = await request.query(query);
      return result;
    } catch (error) {
      logger.error(`Lỗi execute database mới: ${error.message}. Query: ${query.substring(0, 500)}. Params: ${JSON.stringify(params)}`);
      throw error;
    }
  }

  // Đếm số bản ghi
  async count(tableName, schema = 'dbo', isOldDb = true) {
    try {
      const query = `SELECT COUNT(*) as total FROM ${schema}.${tableName}`;
      const pool = isOldDb ? this.oldPool : this.newPool;
      if (!pool) {
        logger.warn(`[BaseModel.count] Không có kết nối tới Database ${isOldDb ? 'CŨ' : 'MỚI'}. Bỏ qua query: ${query}`);
        return 0;
      }
      const result = await pool.request().query(query);
      return result.recordset[0].total;
    } catch (error) {
      logger.error(`Lỗi đếm bản ghi: ${error.message}`);
      throw error;
    }
  }

  // Lấy tất cả bản ghi
  async findAll(tableName, schema = 'dbo', isOldDb = true) {
    try {
      const query = `SELECT * FROM ${schema}.${tableName}`;
      return isOldDb ? await this.queryOldDb(query) : await this.queryNewDb(query);
    } catch (error) {
      logger.error(`Lỗi lấy tất cả bản ghi: ${error.message}`);
      throw error;
    }
  }

  // Lấy bản ghi theo ID
  async findById(tableName, schema = 'dbo', id, isOldDb = true) {
    try {
      const query = `SELECT * FROM ${schema}.${tableName} WHERE ID = @id`;
      const params = { id };
      const result = isOldDb ? await this.queryOldDb(query, params) : await this.queryNewDb(query, params);
      return result[0] || null;
    } catch (error) {
      logger.error(`Lỗi lấy bản ghi theo ID: ${error.message}`);
      throw error;
    }
  }

  // Insert bản ghi
  async insert(tableName, schema, data) {
    try {
      const fields = Object.keys(data);
      const values = fields.map((_, i) => `@param${i}`).join(', ');
      const query = `INSERT INTO ${schema}.${tableName} (${fields.join(', ')}) VALUES (${values})`;
      
      const params = {};
      fields.forEach((field, i) => {
        params[`param${i}`] = data[field];
      });

      const request = this.newPool.request();
      this._bindParams(request, params);

      await request.query(query);
      return true;
    } catch (error) {
      logger.error(`Lỗi insert bản ghi: ${error.message}`);
      throw error;
    }
  }

  // Helper để bind parameters với hỗ trợ Unicode (NVarChar) cho chuỗi
  _bindParams(request, params = {}) {
    Object.keys(params || {}).forEach(key => {
      const value = params[key];
      // Nếu là chuỗi, ép kiểu sang NVarChar để hỗ trợ Unicode (Tiếng Việt)
      if (typeof value === 'string') {
        request.input(key, sql.NVarChar, value);
      } else {
        request.input(key, value);
      }
    });
  }

  // Đóng model (Giải phóng pool reference, không đóng pool thật)
  async close() {
    this.oldPool = null;
    this.newPool = null;
    logger.debug('BaseModel instance references cleared (pool remains active)');
  }
}

module.exports = BaseModel;

const dbConnection = require('../db/connection');
const logger = require('../utils/logger');
const sql = require('mssql');

class BaseModel {
  constructor() {
    this.oldPool = null;
    this.newPool = null;
  }

  // Khởi tạo kết nối
  async initialize() {
    try {
      await dbConnection.connectAll();
      this.oldPool = dbConnection.getOldPool();
      this.newPool = dbConnection.getNewPool();
    } catch (error) {
      console.log('Lỗi khởi tạo BaseModel:', error);
      logger.error('Lỗi khởi tạo BaseModel:', error);
      throw error;
    }
  }

  // Query từ database cũ
  async queryOldDb(query, params = {}) {
    try {
      const request = this.oldPool.request();
      
      // Bind parameters
      Object.keys(params).forEach(key => {
        request.input(key, params[key]);
      });

      const result = await request.query(query);
      return result.recordset;
    } catch (error) {
      logger.error(`Lỗi query database cũ: ${error.message}`);
      throw error;
    }
  }

  // Query từ database mới
  async queryNewDb(query, params = {}) {
    try {
      const request = this.newPool.request();
      
      // Bind parameters
      Object.keys(params).forEach(key => {
        request.input(key, params[key]);
      });

      const result = await request.query(query);
      return result.recordset;
    } catch (error) {
      logger.error(`Lỗi query database mới: ${error.message}`);
      throw error;
    }
  }

  async queryNewDbTx(query, params = {}, transaction = null) {
  try {
    const request = transaction
      ? new sql.Request(transaction)
      : this.newPool.request();

    Object.keys(params || {}).forEach(key => {
      request.input(key, params[key]);
    });

    const result = await request.query(query);
    return result.recordset;
  } catch (error) {
    logger.error(`Lỗi query database mới: ${error.message}`);
    throw error;
  }
}

  // Execute query trên database mới
  async executeNewDb(query, params = {}) {
    try {
      const request = this.newPool.request();
      
      // Bind parameters
      Object.keys(params).forEach(key => {
        request.input(key, params[key]);
      });

      const result = await request.query(query);
      return result;
    } catch (error) {
      logger.error(`Lỗi execute database mới: ${error.message}`);
      throw error;
    }
  }

  // Đếm số bản ghi
  async count(tableName, schema = 'dbo', isOldDb = true) {
    try {
      const query = `SELECT COUNT(*) as total FROM ${schema}.${tableName}`;
      const pool = isOldDb ? this.oldPool : this.newPool;
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
      
      const request = this.newPool.request();
      fields.forEach((field, i) => {
        request.input(`param${i}`, data[field]);
      });

      await request.query(query);
      return true;
    } catch (error) {
      logger.error(`Lỗi insert bản ghi: ${error.message}`);
      throw error;
    }
  }

  // Đóng kết nối
  async close() {
    await dbConnection.closeAll();
  }
}

module.exports = BaseModel;
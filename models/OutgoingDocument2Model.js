// models/OutgoingDocument2Model.js
const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');

class OutgoingDocument2Model extends BaseModel {
  constructor() {
    super();
    this.newTable = 'outgoing_documents2';
    this.newSchema = 'dbo';
  }

  async queryNewDb(sql, params = {}) {
    try {
      const request = this.newPool.request();
      Object.entries(params).forEach(([key, value]) => {
        request.input(key, value);
      });
      const result = await request.query(sql);
      return result;
    } catch (error) {
      logger.error(`Lỗi query outgoing_documents2: ${sql}`, error);
      throw error;
    }
  }

  async getRecordsNeedingSenderUnitUpdate(limit = 10000) {
    try {
      const query = `
        SELECT TOP ${limit} id, DonVi
        FROM ${this.newSchema}.${this.newTable}
        WHERE sender_unit IS NULL 
          AND DonVi IS NOT NULL 
          AND DonVi LIKE '%#%'
        ORDER BY id ASC
      `;
      const result = await this.queryNewDb(query);
      return result?.recordset || [];
    } catch (err) {
      logger.error('[OutgoingDocument2Model] Lỗi getRecordsNeedingSenderUnitUpdate', err);
      return [];
    }
  }

  async updateSenderUnit(id, senderUnitValue) {
    try {
      const query = `
        UPDATE ${this.newSchema}.${this.newTable}
        SET sender_unit = @senderUnit
        WHERE id = @id
      `;
      const request = this.newPool.request()
        .input('senderUnit', senderUnitValue)
        .input('id', id);
      await request.query(query);
    } catch (err) {
      logger.error(`[OutgoingDocument2Model] Lỗi updateSenderUnit id=${id}`, err);
      throw err;
    }
  }

  async findRecordById(id) {
    try {
      const query = `
        SELECT id, DonVi, sender_unit
        FROM ${this.newSchema}.${this.newTable}
        WHERE id = @id
      `;
      const result = await this.queryNewDb(query, { id });
      return result?.recordset?.[0] || null;
    } catch (err) {
      logger.error(`[OutgoingDocument2Model] Lỗi findRecordById id=${id}`, err);
      return null;
    }
  }

  async updateSenderUnit(id, senderUnitValue) {
    try {
      const query = `
        UPDATE ${this.newSchema}.${this.newTable}
        SET sender_unit = @senderUnit
        WHERE id = @id
      `;
      const request = this.newPool.request()
        .input('senderUnit', senderUnitValue)
        .input('id', id);
      await request.query(query);
    } catch (err) {
      logger.error(`Lỗi updateSenderUnit id=${id}`, err);
      throw err;
    }
  }

    // ────────────────────────────────────────────────
  // Các method hỗ trợ cho SenderUnitUpdaterService
  // ────────────────────────────────────────────────

  /**
   * Lấy danh sách record cần update sender_unit (có DonVi hợp lệ, sender_unit NULL)
   * @param {number} limit - Giới hạn số record trả về (mặc định 10000 để tránh quá tải)
   */
  async getRecordsNeedingSenderUnitUpdate(limit = 10000) {
    try {
      const query = `
        SELECT TOP ${limit} id, DonVi
        FROM ${this.newSchema}.${this.newTable}
        WHERE sender_unit IS NULL 
          AND DonVi IS NOT NULL 
          AND DonVi LIKE '%#%'
        ORDER BY id ASC
      `;
      const { recordset } = await this.queryNewDb(query);
      return recordset || [];
    } catch (err) {
      logger.error('[OutgoingDocument2Model] Lỗi getRecordsNeedingSenderUnitUpdate', err);
      throw err;
    }
  }

  /**
   * Update giá trị sender_unit cho 1 record theo id
   */
  async updateSenderUnit(id, senderUnitValue) {
    try {
      const query = `
        UPDATE ${this.newSchema}.${this.newTable}
        SET sender_unit = @senderUnit
        WHERE id = @id
      `;
      const request = this.newPool.request()
        .input('senderUnit', senderUnitValue)
        .input('id', id);

      await request.query(query);
    } catch (err) {
      logger.error(`[OutgoingDocument2Model] Lỗi updateSenderUnit id=${id}`, err);
      throw err;
    }
  }

  /**
   * Tìm 1 record theo id (dùng cho updateById)
   */
  async findRecordById(id) {
    try {
      const query = `
        SELECT id, DonVi, sender_unit
        FROM ${this.newSchema}.${this.newTable}
        WHERE id = @id
      `;
      const { recordset } = await this.queryNewDb(query, { id });
      return recordset && recordset.length > 0 ? recordset[0] : null;
    } catch (err) {
      logger.error(`[OutgoingDocument2Model] Lỗi findRecordById id=${id}`, err);
      throw err;
    }
  }

  async findRecordById(id) {
    try {
      const query = `
        SELECT id, DonVi, sender_unit
        FROM ${this.newSchema}.${this.newTable}
        WHERE id = @id
      `;
      const { recordset } = await this.queryNewDb(query, { id });
      return recordset.length > 0 ? recordset[0] : null;
    } catch (err) {
      logger.error(`Lỗi findRecordById id=${id}`, err);
      throw err;
    }
  }
  async countNewDb() {
    try {
      const result = await this.queryNewDb(`
        SELECT COUNT(*) AS total 
        FROM ${this.newSchema}.${this.newTable}
      `);
      return result.recordset[0].total;
    } catch (error) {
      logger.error('Lỗi đếm outgoing_documents2:', error);
      throw error;
    }
  }

  async close() {
    if (this.newPool && this.newPool.close) await this.newPool.close();
  }
}

module.exports = OutgoingDocument2Model;
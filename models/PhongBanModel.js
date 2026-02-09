const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');

class PhongBanModel extends BaseModel {
  constructor() {
    super();
    this.oldTable = 'PhongBan';
    this.oldSchema = 'dbo';
    this.newTable = 'organization_units';
    this.newSchema = 'dbo';
  }

  async getAllFromOldDb() {
    try {
      const query = `
        SELECT 
          ID,
          TitleVn,
          Code,
          ParentID
        FROM ${this.oldSchema}.${this.oldTable}
        ORDER BY ID
      `;
      return await this.queryOldDb(query);
    } catch (error) {
      logger.error('Lỗi lấy danh sách phòng ban từ DB cũ:', error);
      throw error;
    }
  }

  async countOldDb() {
    return await this.count(this.oldTable, this.oldSchema, true);
  }

  async findByBackupId(backupId) {
    try {
      const query = `
        SELECT id, name, code, Id_backups
        FROM ${this.newSchema}.${this.newTable}
        WHERE Id_backups = @backupId
      `;
      const result = await this.queryNewDb(query, { backupId });
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      logger.error('Lỗi tìm record theo backup ID:', error);
      throw error;
    }
  }

  async checkIdExistsInNewDb(id) {
    try {
      const query = `
        SELECT COUNT(*) as count 
        FROM ${this.newSchema}.${this.newTable} 
        WHERE id = @id
      `;
      const result = await this.queryNewDb(query, { id });
      return result[0].count > 0;
    } catch (error) {
      logger.error('Lỗi kiểm tra ID tồn tại:', error);
      throw error;
    }
  }

  async insertToNewDb(data) {
    try {
      const fields = [];
      const values = [];
      const params = {};

      let paramIndex = 0;
      for (const [key, value] of Object.entries(data)) {
        fields.push(key);
        values.push(`@param${paramIndex}`);
        params[`param${paramIndex}`] = value;
        paramIndex++;
      }

      const query = `
        INSERT INTO ${this.newSchema}.${this.newTable} 
        (${fields.join(', ')}) 
        VALUES (${values.join(', ')})
      `;

      const request = this.newPool.request();
      Object.keys(params).forEach(key => {
        request.input(key, params[key]);
      });

      await request.query(query);
      return true;
    } catch (error) {
      logger.error('Lỗi insert phòng ban:', error);
      throw error;
    }
  }

  async getRecordsNeedingSenderUnitUpdate() {
  try {
    const query = `
      SELECT id, DonVi
      FROM dbo.outgoing_documents2
      WHERE sender_unit IS NULL
        AND DonVi IS NOT NULL
        AND DonVi LIKE '%#%'
      ORDER BY id
    `;
    const { recordset } = await this.queryNewDb(query);
    return recordset || [];
  } catch (err) {
    logger.error('Lỗi getRecordsNeedingSenderUnitUpdate', err);
    throw err;
  }
}

// Update sender_unit cho 1 record
async updateSenderUnit(id, senderUnitValue) {
  try {
    const query = `
      UPDATE dbo.outgoing_documents2
      SET sender_unit = @senderUnit
      WHERE id = @id
    `;
    const request = this.newPool.request()
      .input('senderUnit', senderUnitValue)
      .input('id', id);

    await request.query(query);
  } catch (err) {
    logger.error(`Lỗi update sender_unit cho id=${id}`, err);
    throw err;
  }
}

  async getAllFromNewDb() {
    try {
      const query = `
        SELECT 
          id, name, code, type, phone_number, email, 
          leader, position, address, description, 
          display_order, status, mpath, parentId, 
          created_at, updated_at, Id_backups, table_backups
        FROM ${this.newSchema}.${this.newTable}
        ORDER BY id
      `;
      return await this.queryNewDb(query);
    } catch (error) {
      logger.error('Lỗi lấy danh sách organization_units:', error);
      throw error;
    }
  }

  async countNewDb() {
    return await this.count(this.newTable, this.newSchema, false);
  }

  async truncateNewTable() {
    try {
      const query = `TRUNCATE TABLE ${this.newSchema}.${this.newTable}`;
      await this.executeNewDb(query);
      logger.info('Đã xóa toàn bộ dữ liệu bảng organization_units');
      return true;
    } catch (error) {
      logger.error('Lỗi truncate bảng:', error);
      throw error;
    }
  }
}



module.exports = PhongBanModel;
// models/SharePointGroupModel.js
const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');

class SharePointGroupModel extends BaseModel {
  constructor() {
    super();
    this.oldTable = '[Group]';  // Dấu ngoặc vuông cho từ khóa
    this.oldSchema = 'dbo';
    this.newTable = 'group_users';
    this.newSchema = 'dbo';
  }

  async getAllFromOldDb() {
    try {
      logger.info(`📂 Lấy dữ liệu từ bảng ${this.oldTable}...`);

      const query = `
        SELECT
          ID,
          Title,
          Description,
          Owner,
          WhoView,
          SPGroupId,
          Modified,
          Created
        FROM ${this.oldSchema}.${this.oldTable}
        ORDER BY Created
      `;

      const results = await this.queryOldDb(query);

      if (results && results.length > 0) {
        logger.info(`✅ Lấy được ${results.length} records từ bảng Group`);

        // Log mẫu
        const sample = results[0];
        logger.info(`📋 Mẫu: ID=${sample.ID}, Title=${sample.Title}, WhoView=${sample.WhoView}`);
      }

      return results;
    } catch (error) {
      logger.error(`❌ Lỗi lấy dữ liệu ${this.oldTable}:`, error);
      throw error;
    }
  }

  async countOldDb() {
    try {
      const query = `SELECT COUNT(*) as count FROM ${this.oldSchema}.${this.oldTable}`;
      const result = await this.queryOldDb(query);
      const count = result[0].count;
      logger.info(`Số lượng records trong ${this.oldTable}: ${count}`);
      return count;
    } catch (error) {
      logger.error('Lỗi đếm số lượng records:', error);
      throw error;
    }
  }

  async findByBackupId(backupId) {
    try {
      const query = `
        SELECT id, name, code, id_group_bk
        FROM ${this.newSchema}.${this.newTable}
        WHERE id_group_bk = @backupId
      `;
      const result = await this.queryNewDb(query, { backupId });
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      logger.error('Lỗi tìm record theo id_group_bk:', error);
      throw error;
    }
  }

  async checkCodeExists(code) {
    try {
      if (!code || code.trim() === '') return true;

      const query = `
        SELECT COUNT(*) as count
        FROM ${this.newSchema}.${this.newTable}
        WHERE code = @code
      `;
      const result = await this.queryNewDb(query, { code });
      return result[0].count > 0;
    } catch (error) {
      logger.error('Lỗi kiểm tra code tồn tại:', error);
      throw error;
    }
  }

  async insertToNewDb(data) {
    try {
      // Validate
      if (!data.id) throw new Error('ID là bắt buộc');
      if (!data.name || data.name.trim() === '') throw new Error('Name là bắt buộc');
      if (!data.code || data.code.trim() === '') throw new Error('Code là bắt buộc');

      const fields = Object.keys(data);
      const values = fields.map((_, i) => `@param${i}`).join(', ');

      const query = `
        INSERT INTO ${this.newSchema}.${this.newTable}
        (${fields.join(', ')})
        VALUES (${values})
      `;

      logger.debug(`SQL Insert: ${query}`);

      const request = this.newPool.request();

      fields.forEach((field, i) => {
        const value = data[field];

        // Xử lý kiểu dữ liệu
        if (field === 'status') {
          const statusValue = parseInt(value) || 1;
          request.input(`param${i}`, statusValue);
        } else if (field === 'createdAt' || field === 'updatedAt') {
          const dateValue = value ? new Date(value) : new Date();
          request.input(`param${i}`, dateValue);
        } else if (typeof value === 'boolean') {
          request.input(`param${i}`, value ? 1 : 0);
        } else {
          request.input(`param${i}`, value);
        }
      });

      await request.query(query);
      logger.debug(`✓ Insert group: ${data.code} - ${data.name}`);
      return true;

    } catch (error) {
      logger.error('❌ Lỗi insert Group:', error.message);
      logger.error('Data:', JSON.stringify(data, null, 2));
      throw error;
    }
  }

  async countNewDb() {
    try {
      const query = `SELECT COUNT(*) as count FROM ${this.newSchema}.${this.newTable}`;
      const result = await this.queryNewDb(query);
      const count = result[0].count;
      logger.info(`Số lượng records trong ${this.newTable}: ${count}`);
      return count;
    } catch (error) {
      logger.error('Lỗi đếm records trong DB mới:', error);
      throw error;
    }
  }

  async getUserIdFromOwnerGuid(ownerGuid) {
    try {
      if (!ownerGuid) return null;

      // Tìm user trong bảng users
      const query = `
        SELECT id
        FROM ${this.newSchema}.users
        WHERE id_user_bak = @ownerGuid OR id_user_del_bak = @ownerGuid OR id = @ownerGuid
      `;

      const result = await this.queryNewDb(query, { ownerGuid });
      return result.length > 0 ? result[0].id : null;

    } catch (error) {
      logger.error('Lỗi map Owner GUID:', error);
      return null;
    }
  }

  // Test method để debug
  async testConnection() {
    try {
      const count = await this.countOldDb();
      const sample = await this.getAllFromOldDb();

      return {
        connected: true,
        recordCount: count,
        sampleData: sample ? sample.slice(0, 3) : []
      };
    } catch (error) {
      return {
        connected: false,
        error: error.message
      };
    }
  }
}

module.exports = SharePointGroupModel;

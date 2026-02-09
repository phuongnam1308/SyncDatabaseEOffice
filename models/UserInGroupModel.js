// models/UserInGroupModel.js
const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');

class UserInGroupModel extends BaseModel {
  constructor() {
    super();
    this.oldTable = 'UserInGroup';
    this.oldSchema = 'dbo';
    this.newTable = 'user_group_users_bak';
    this.newSchema = 'dbo';
  }

  async getAllFromOldDb() {
    try {
      const query = `
        SELECT 
          UserId,
          GroupId,
          Modified
        FROM ${this.oldSchema}.${this.oldTable}
        ORDER BY UserId, GroupId
      `;
      return await this.queryOldDb(query);
    } catch (error) {
      logger.error('Lỗi lấy danh sách UserInGroup từ DB cũ:', error);
      throw error;
    }
  }

  async countOldDb() {
    return await this.count(this.oldTable, this.oldSchema, true);
  }

  // Kiểm tra trùng lặp qua cặp UserId + GroupId cũ
  async findByBackupIds(userIdBak, groupIdBak) {
    try {
      const query = `
        SELECT id_user_bak, id_group_bak
        FROM ${this.newSchema}.${this.newTable}
        WHERE id_user_bak = @userIdBak AND id_group_bak = @groupIdBak
      `;
      const result = await this.queryNewDb(query, { userIdBak: userIdBak, groupIdBak: groupIdBak });
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      logger.error('Lỗi tìm record theo id_user_bak + id_group_bak:', error);
      throw error;
    }
  }

  async insertToNewDb(data) {
    try {
      const fields = Object.keys(data);
      const values = fields.map((_, i) => `@param${i}`).join(', ');
      const query = `
        INSERT INTO ${this.newSchema}.${this.newTable} 
        (${fields.join(', ')}) 
        VALUES (${values})
      `;

      const request = this.newPool.request();
      fields.forEach((field, i) => {
        request.input(`param${i}`, data[field]);
      });

      await request.query(query);
      return true;
    } catch (error) {
      logger.error('Lỗi insert UserInGroup vào user_group_users_bak:', error);
      throw error;
    }
  }

  async countNewDb() {
    return await this.count(this.newTable, this.newSchema, false);
  }
}

module.exports = UserInGroupModel;
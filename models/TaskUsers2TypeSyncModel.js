const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');

class TaskUsers2TypeSyncModel extends BaseModel {
  constructor() {
    super();
    this.schema = 'dbo';
    this.table = 'task_users2';
  }

  async updateTypeFromUserType() {
    try {
      const query = `
        UPDATE ${this.schema}.${this.table}
        SET
          [type] = UserType,
          update_at = GETDATE()
        WHERE UserType IS NOT NULL
          AND ([type] IS NULL OR [type] <> UserType)
      `;
      const result = await this.queryNewDb(query);
      return result?.rowsAffected?.[0] || 0;
    } catch (error) {
      logger.error('Lỗi update type từ UserType:', error);
      throw error;
    }
  }
}

module.exports = TaskUsers2TypeSyncModel;

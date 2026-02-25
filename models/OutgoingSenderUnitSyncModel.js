const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');

class OutgoingSenderUnitSyncModel extends BaseModel {
  constructor() {
    super();
    this.schema = 'dbo';
    this.table = 'outgoing_documents';
  }

  // Lấy batch record cần xử lý
  async getBatch(limit) {
    const query = `
      SELECT TOP (${limit})
        id,
        sender_unit
      FROM ${this.schema}.${this.table}
      WHERE table_backup = 'outgoing_documents2'
        AND sender_unit IS NOT NULL
        AND sender_unit LIKE '%;#%'
    `;
    return await this.queryNewDb(query);
  }

  // Lấy mapping đơn vị theo tên
  async getOrganizationMapByNames(names = []) {
    if (!names.length) return [];

    const placeholders = names.map((_, i) => `@n${i}`).join(', ');
    const params = {};
    names.forEach((n, i) => (params[`n${i}`] = n));

    const query = `
      SELECT id, name
      FROM DiOffice.dbo.organization_units
      WHERE name IN (${placeholders})
    `;

    return await this.queryNewDb(query, params);
  }

  // Update sender_unit mới
  async updateSenderUnit(id, value) {
    const query = `
      UPDATE ${this.schema}.${this.table}
      SET sender_unit = @value
      WHERE id = @id
    `;
    await this.executeNewDb(query, { id, value });
  }
}

module.exports = OutgoingSenderUnitSyncModel;

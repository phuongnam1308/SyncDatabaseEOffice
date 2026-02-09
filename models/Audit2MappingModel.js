const BaseModel = require('./BaseModel');

class Audit2MappingUserIdModel extends BaseModel {
  constructor() {
    super();
    this.schema = 'dbo';
    this.auditTable = 'audit2';
    this.userTable = 'users';
  }

  async getAuditsNeedMapping() {
    const query = `
      SELECT id, NguoiXuLy, display_name
      FROM ${this.schema}.${this.auditTable}
      WHERE user_id IS NULL
        AND (NguoiXuLy IS NOT NULL OR display_name IS NOT NULL)
    `;
    return this.queryNewDb(query);
  }

  async findUserByNameLike(name) {
    const query = `
      SELECT TOP 1 id
      FROM ${this.schema}.${this.userTable}
      WHERE name IS NOT NULL
        AND (
          LTRIM(RTRIM(name)) LIKE '%' + LTRIM(RTRIM(@name)) + '%'
          OR LTRIM(RTRIM(@name)) LIKE '%' + LTRIM(RTRIM(name)) + '%'
        )
    `;
    const rs = await this.queryNewDb(query, { name });
    return rs.length ? rs[0] : null;
  }

  async updateUserId(auditId, userId) {
    const query = `
      UPDATE ${this.schema}.${this.auditTable}
      SET user_id = @userId
      WHERE id = @auditId
    `;
    await this.queryNewDb(query, { auditId, userId });
  }
}

module.exports = Audit2MappingUserIdModel;

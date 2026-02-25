const BaseModel = require('./BaseModel');

class AuditActionCodeModel extends BaseModel {
  async getAudit2NeedUpdate() {
    const sql = `
      SELECT id, HanhDong
      FROM DiOffice.dbo.audit2
      WHERE action_code IS NULL
    `;
    return this.queryNewDb(sql);
  }

  async getActionCodeMapping() {
    const sql = `
      SELECT 
        action_code,
        keyword_pattern,
        keyword_pattern_2,
        keyword_pattern_3,
        keyword_pattern_4,
        match_type,
        priority
      FROM dbo.action_code_mapping
      ORDER BY priority ASC
    `;
    return this.queryNewDb(sql);
  }

  async updateActionCode(id, actionCode) {
    const sql = `
      UPDATE DiOffice.dbo.audit2
      SET action_code = @action_code
      WHERE id = @id
    `;
    return this.queryNewDb(sql, { id, action_code: actionCode });
  }
}

module.exports = AuditActionCodeModel;

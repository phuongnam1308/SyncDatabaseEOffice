const BaseModel = require('./BaseModel');

class Audit2RoleProcessSyncModel extends BaseModel {
  constructor() {
    super();
    this.schema = 'dbo';
    this.auditTable = 'audit2';
    this.mappingTable = 'audit2_role_mapping';
  }

  async getAuditsNeedSync() {
    const query = `
      SELECT id, NguoiXuLy, HanhDong
      FROM ${this.schema}.${this.auditTable}
      WHERE role IS NULL
         OR roleProcess IS NULL
    `;
    return this.queryNewDb(query);
  }

  async getRoleMappingByNguoiXuLy(name) {
    const query = `
      SELECT TOP 1 role
      FROM ${this.schema}.${this.mappingTable}
      WHERE
        (@name LIKE nguoi_xu_ly_like
        OR @name LIKE nguoi_xu_ly_like1
        OR @name LIKE nguoi_xu_ly_like2
        OR @name LIKE nguoi_xu_ly_like3)
        AND role IS NOT NULL
    `;
    const rs = await this.queryNewDb(query, { name });
    return rs.length ? rs[0].role : null;
  }

  async getRoleProcessByHanhDong(action) {
    const query = `
      SELECT TOP 1 roleProcess
      FROM ${this.schema}.${this.mappingTable}
      WHERE
        (@action LIKE hanh_dong_like
        OR @action LIKE hanh_dong_like1
        OR @action LIKE hanh_dong_like2
        OR @action LIKE hanh_dong_like3)
        AND roleProcess IS NOT NULL
    `;
    const rs = await this.queryNewDb(query, { action });
    return rs.length ? rs[0].roleProcess : null;
  }

  async updateRole(auditId, role, roleProcess) {
    const query = `
      UPDATE ${this.schema}.${this.auditTable}
      SET role = @role,
          roleProcess = @roleProcess
      WHERE id = @auditId
    `;
    await this.queryNewDb(query, { auditId, role, roleProcess });
  }
}

module.exports = Audit2RoleProcessSyncModel;

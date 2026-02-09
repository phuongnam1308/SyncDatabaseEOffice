const BaseModel = require('./BaseModel');
const mssql = require('mssql');
const logger = require('../utils/logger');

class AuditLuanchuyenHCModel extends BaseModel {
  constructor() {
    super();
    this.oldTable = 'LuanChuyenVanBan_HC';
    this.oldSchema = 'dbo';
    this.newTable = 'audit3';
    this.newSchema = 'dbo';
  }

  async getAllFromOldDb() {
    const sql = `
      SELECT
        ID,
        IDVanBan,
        NguoiXuLy,
        NgayTao,
        HanhDong,
        Category,
        IDVanBanGoc,
        VBId,
        VBGocId
      FROM ${this.oldSchema}.${this.oldTable}
      ORDER BY ID
    `;
    return this.queryOldDb(sql);
  }

  async findByBackupId(id) {
    const sql = `
      SELECT id
      FROM ${this.newSchema}.${this.newTable}
      WHERE origin_id = @id
    `;
    const rs = await this.queryNewDb(sql, { id });
    return rs.length > 0;
  }

  async insertToNewDb(row) {
    try {
      const sql = `
        INSERT INTO ${this.newSchema}.${this.newTable} (
          origin_id,
          document_id,
          [time],
          user_id,
          display_name,
          [role],
          action_code,
          from_node_id,
          to_node_id,
          details,
          created_by,
          receiver,
          receiver_unit,
          group_,
          roleProcess,
          [action],
          deadline,
          stage_status,
          curStatusCode,
          created_at,
          updated_at,
          type_document,
          processed_by,

          IDVanBan,
          NguoiXuLy,
          NgayTao,
          HanhDong,
          Category,
          IDVanBanGoc,
          VBId,
          VBGocId,

          table_backups
        )
        VALUES (
          @origin_id,
          NULL,
          @time,
          NULL,
          @display_name,
          NULL,
          'PROCESS_DOCUMENT',
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          @action,
          NULL,
          NULL,
          NULL,
          GETDATE(),
          GETDATE(),
          NULL,
          @processed_by,

          @IDVanBan,
          @NguoiXuLy,
          @NgayTao,
          @HanhDong,
          @Category,
          @IDVanBanGoc,
          @VBId,
          @VBGocId,

          'LuanChuyenVanBan_HC'
        )
      `;

      const req = this.newPool.request();
      req.input('origin_id', mssql.NVarChar, String(row.ID));
      req.input('time', mssql.DateTime, new Date(row.NgayTao));
      req.input('display_name', mssql.NVarChar, row.NguoiXuLy);
      req.input('processed_by', mssql.NVarChar, row.NguoiXuLy);
      req.input('action', mssql.NVarChar, row.HanhDong);

      req.input('IDVanBan', mssql.NVarChar, row.IDVanBan);
      req.input('NguoiXuLy', mssql.NVarChar, row.NguoiXuLy);
      req.input('NgayTao', mssql.NVarChar, row.NgayTao);
      req.input('HanhDong', mssql.NVarChar, row.HanhDong);
      req.input('Category', mssql.NVarChar, row.Category);
      req.input('IDVanBanGoc', mssql.NVarChar, row.IDVanBanGoc);
      req.input('VBId', mssql.NVarChar, row.VBId);
      req.input('VBGocId', mssql.NVarChar, row.VBGocId);

      await req.query(sql);
    } catch (err) {
      logger.error('Insert audit3 failed:', err);
      throw err;
    }
  }
}

module.exports = AuditLuanchuyenHCModel;

const BaseModel = require('./BaseModel');
const mssql = require('mssql');
const logger = require('../utils/logger');

class MessageNghiPhepCBQLModel extends BaseModel {
  constructor() {
    super();
    this.oldTable = 'MessageNghiPhep_CBQL';
    this.oldSchema = 'dbo';
    this.newTable = 'audit_message_nghiphep_cbql';   // bảng đích mới
    this.newSchema = 'dbo';
  }

  async getAllFromOldDb() {
    const sql = `
      SELECT
        ID,
        DocumentId,
        Content,
        CC,
        [To],
        Created,
        IsSent,
        IsRemoved,
        IsDeleted,
        IsRead,
        IsMarked,
        IsImportant,
        ListErrNumberPhone,
        SendDate
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
          content,
          cc,
          [to],
          created,
          is_sent,
          is_removed,
          is_deleted,
          is_read,
          is_marked,
          is_important,
          list_err_number_phone,
          send_date,
          created_at,
          table_source
        )
        VALUES (
          @origin_id,
          @document_id,
          @content,
          @cc,
          @to,
          @created,
          @is_sent,
          @is_removed,
          @is_deleted,
          @is_read,
          @is_marked,
          @is_important,
          @list_err_number_phone,
          @send_date,
          GETDATE(),
          'MessageNghiPhep_CBQL'
        )
      `;

      const req = this.newPool.request();
      req.input('origin_id',               mssql.NVarChar, String(row.ID));
      req.input('document_id',             mssql.NVarChar, row.DocumentId);
      req.input('content',                 mssql.NVarChar(mssql.MAX), row.Content);  // TEXT dài → dùng NVARCHAR(MAX)
      req.input('cc',                      mssql.NVarChar(mssql.MAX), row.CC);
      req.input('to',                      mssql.NVarChar(mssql.MAX), row.To);
      req.input('created',                 mssql.DateTime, new Date(row.Created));
      req.input('is_sent',                 mssql.Bit, row.IsSent ? 1 : 0);
      req.input('is_removed',              mssql.Bit, row.IsRemoved ? 1 : 0);
      req.input('is_deleted',              mssql.Bit, row.IsDeleted ? 1 : 0);
      req.input('is_read',                 mssql.Bit, row.IsRead ? 1 : 0);
      req.input('is_marked',               mssql.Bit, row.IsMarked ? 1 : 0);
      req.input('is_important',            mssql.Bit, row.IsImportant ? 1 : 0);
      req.input('list_err_number_phone',   mssql.NVarChar(mssql.MAX), row.ListErrNumberPhone);
      req.input('send_date',               mssql.DateTime, row.SendDate ? new Date(row.SendDate) : null);

      await req.query(sql);
    } catch (err) {
      logger.error('Insert audit_message_nghiphep_cbql failed:', err);
      throw err;
    }
  }
}

module.exports = MessageNghiPhepCBQLModel;
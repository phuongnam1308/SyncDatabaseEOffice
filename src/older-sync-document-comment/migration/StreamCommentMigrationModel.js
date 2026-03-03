const BaseModel = require("../../../models/BaseModel");
const logger = require("../../../utils/logger");
const sql = require("mssql");
const MigrationHelper = require("../../helpers/MigrationHelper");

// ── Danh sách bảng comment trong DB cũ ───────────────────────
const COMMENT_TABLES = [
  'Comments',
  'Comments_ATPC',
  'Comments_CLL',
  'Comments_CNTT',
  'Comments_CT',
  'Comments_CVTC',
  'Comments_DonVi',
  'Comments_DVHH',
  'Comments_DVKT',
  'Comments_GNVT',
  'Comments_HC',
  'Comments_HT',
  'Comments_ICDLB',
  'Comments_ICDST',
  'Comments_KHDT',
  'Comments_KHKD',
  'Comments_KTVT',
  'Comments_KVTC',
  'Comments_MKT',
  'Comments_NPL',
  'Comments_QLCT',
  'Comments_QSBV',
  'Comments_SNPL',
  'Comments_TC',
  'Comments_TC189',
  'Comments_TCCT',
  'Comments_TCHP',
  'Comments_TCIDI',
  'Comments_TCLD',
  'Comments_TCMT',
  'Comments_TCO',
  'Comments_TCOT',
  'Comments_TCPC',
  'Comments_TCPH',
  'Comments_TCTT',
  'Comments_TTDDC',
  'Comments_TTDTC',
  'Comments_VP',
  'Comments_VPMB',
  'Comments_VPTNB',
  'Comments_VTB',
  'Comments_VTT',
  'Comments_XDCT',
  'Comments_xdsm',
  'Comments_XNCG',
  'Comments_YTE',
];
class StreamCommentMigrationModel extends BaseModel {
  constructor(oldDbTable) {
    super();
    this.oldDbSchema = "dbo";
    this.oldDbTable = oldDbTable;
    this.newDbSchema = "dbo";
    this.newDbTable = "document_comments_sync";
    this.helper = new MigrationHelper(this.queryNewDbTx.bind(this), this.queryOldDb.bind(this));
  }

  async fetchBatch({ batch, lastId }) {
    const query = `
      SELECT TOP (@batch) *
      FROM ${this.oldDbSchema}.${this.oldDbTable}
      WHERE (@lastId IS NULL OR ID > @lastId)
      ORDER BY ID ASC
    `;
    return this.queryOldDb(query, { batch, lastId: lastId || null });
  }

  /**
   * Lấy tất cả bản ghi comment liên quan đến một văn bản cụ thể từ bảng cũ.
   * Được gọi bởi document migration model để truy vấn comment theo oldDocumentId.
   *
   * @param {string|number} oldDocumentId - ID văn bản trong hệ thống cũ (DocumentID)
   * @returns {Promise<Array>} Danh sách bản ghi comment thô từ DB cũ
   */
  async fetchByDocumentId(oldDocumentId) {
    if (!oldDocumentId) return [];
    try {
      const query = `
        SELECT *
        FROM ${this.oldDbSchema}.${this.oldDbTable}
        WHERE DocumentID = @oldDocumentId
        ORDER BY ID ASC
      `;
      return this.queryOldDb(query, { oldDocumentId: String(oldDocumentId) });
    } catch (error) {
      logger.error(`[StreamCommentMigrationModel.fetchByDocumentId] table=${this.oldDbTable} id=${oldDocumentId}:`, error);
      throw error;
    }
  }

  /**
   * Migrate một bản ghi comment đơn lẻ từ DB cũ sang bảng document_comments_sync.
   * Được gọi bởi document migration model thay vì xử lý theo batch.
   *
   * @param {object} rawRecord - Bản ghi thô từ DB cũ
   * @param {object} [externalTransaction] - Transaction bên ngoài (tùy chọn)
   * @returns {Promise<object|null>} Bản ghi đã được sync trong document_comments_sync,
   *                                 hoặc null nếu bỏ qua
   */
  async processSingleRecord(rawRecord, externalTransaction = null) {
    if (!rawRecord) return null;

    const transaction = externalTransaction || await this.beginTransaction();
    const ownsTransaction = !externalTransaction;

    try {
      const mapped = await this._mapRecord(rawRecord, transaction);
      if (!mapped) {
        if (ownsTransaction) await this.commitTransaction(transaction);
        return null;
      }

      const existed = await this._getExisting(mapped, transaction);
      if (existed) {
        await this._update(mapped, transaction);
      } else {
        await this._insert(mapped, transaction);
      }

      if (ownsTransaction) await this.commitTransaction(transaction);

      // Trả về bản ghi đã sync để caller có thể tiếp tục apply vào bảng chính
      return { ...mapped, _existed: !!existed };
    } catch (error) {
      if (ownsTransaction) await this.rollbackTransaction(transaction);
      logger.error(`[StreamCommentMigrationModel.processSingleRecord] table=${this.oldDbTable} ID=${rawRecord?.ID}:`, error);
      throw error;
    }
  }

  async insertBatchToNewDb(records) {
    if (!records?.length) return { inserted: 0, updated: 0 };

    const transaction = await this.beginTransaction();
    let inserted = 0;
    let updated = 0;

    try {
      for (const raw of records) {
        try {
          const mapped = await this._mapRecord(raw, transaction);
          if (!mapped) continue;

          const existed = await this._getExisting(mapped, transaction);
          if (existed) {
            await this._update(mapped, transaction);
            updated++;
          } else {
            await this._insert(mapped, transaction);
            inserted++;
          }
        } catch (err) {
          logger.warn(`[CommentSync:${this.oldDbTable}] Skip ID=${raw?.ID}: ${err.message}`);
        }
      }

      await this.commitTransaction(transaction);
      return { inserted, updated };
    } catch (error) {
      await this.rollbackTransaction(transaction);
      throw error;
    }
  }

  async _mapRecord(record, transaction) {
    if (!record?.ID) return null;

    const documentId = await this._resolveDocumentId(record.DocumentID, transaction);
    const userId = await this.helper.mapUserName(record.Author, transaction);
    const userName = this.helper.extractDisplayName(record.Author);

    const id = Date.now();

    return {
      id,
      document_id: documentId?.document_id || null,
      document_id_bak: record.DocumentID ? String(record.DocumentID) : null,
      user_id: userId || null,
      user_id_bak: record.Author || null,
      user_name: userName,
      content: record.Content || "",
      type: record.Type ? String(record.Type) : null,
      type_bak: record.Type ? String(record.Type) : null,
      created_at: this.helper.parseDate(record.Created),
      file_id: record.Files || null,
      likes: record.LikeNumber ? String(record.LikeNumber) : null,
      id_comments_bak: String(record.ID),
      parent_id_bak: record.ReplyTo || record.CommentID || null,
      table_backup: this.oldDbTable,
    };
  }

  async _resolveDocumentId(documentIdBak, transaction) {
    if (!documentIdBak) return null;
    const normalized = String(documentIdBak).trim();
    if (!normalized) return null;

    const outgoing = await this.queryNewDbTx(
      `SELECT TOP 1 document_id FROM ${process.env.NEW_DB_NAME}.dbo.outgoing_documents_sync WHERE id_outgoing_bak = @id`,
      { id: normalized },
      transaction
    );
    if (outgoing?.length) return { document_id: outgoing[0].document_id, type_document: "OutgoingDocument" };

    const incoming = await this.queryNewDbTx(
      `SELECT TOP 1 document_id FROM ${process.env.NEW_DB_NAME}.dbo.incomming_documents2 WHERE id_incoming_bak = @id`,
      { id: normalized },
      transaction
    );
    if (incoming?.length) return { document_id: incoming[0].document_id, type_document: "IncommingDocument" };

    return null;
  }

  async _getExisting(mapped, transaction) {
    if (!mapped?.id_comments_bak) return null;
    const result = await this.queryNewDbTx(
      `SELECT TOP 1 id FROM ${process.env.NEW_DB_NAME}.dbo.document_comments_sync WHERE id_comments_bak = @bak AND table_backup = @table`,
      { bak: mapped.id_comments_bak, table: mapped.table_backup },
      transaction
    );
    return result?.[0] || null;
  }

  async _insert(data, transaction) {
    const query = `
      INSERT INTO ${process.env.NEW_DB_NAME}.dbo.document_comments_sync (
        id, document_id, user_id, user_name, content, [type],
        created_at, updated_at, file_id, likes,
        id_comments_bak, document_id_bak, type_bak,
        table_backup, parent_id_bak, user_id_bak
      ) VALUES (
        @id, @documentId, @userId, @userName, @content, @type,
        @createdAt, GETDATE(), @fileId, @likes,
        @idCommentsBak, @documentIdBak, @typeBak,
        @tableBackup, @parentIdBak, @userIdBak
      )
    `;
    await this.queryNewDbTx(query, {
      id: data.id,
      documentId: data.document_id,
      userId: data.user_id,
      userName: data.user_name,
      content: data.content,
      type: data.type,
      createdAt: data.created_at,
      fileId: data.file_id,
      likes: data.likes,
      idCommentsBak: data.id_comments_bak,
      documentIdBak: data.document_id_bak,
      typeBak: data.type_bak,
      tableBackup: data.table_backup,
      parentIdBak: data.parent_id_bak,
      userIdBak: data.user_id_bak,
    }, transaction);
  }

  async _update(data, transaction) {
    const query = `
      UPDATE ${process.env.NEW_DB_NAME}.dbo.document_comments_sync
      SET
        document_id = @documentId,
        user_id = @userId,
        user_name = @userName,
        content = @content,
        [type] = @type,
        file_id = @fileId,
        likes = @likes,
        updated_at = GETDATE(),
        parent_id_bak = @parentIdBak,
        user_id_bak = @userIdBak
      WHERE id_comments_bak = @idCommentsBak AND table_backup = @tableBackup
    `;
    await this.queryNewDbTx(query, {
      documentId: data.document_id,
      userId: data.user_id,
      userName: data.user_name,
      content: data.content,
      type: data.type,
      fileId: data.file_id,
      likes: data.likes,
      parentIdBak: data.parent_id_bak,
      userIdBak: data.user_id_bak,
      idCommentsBak: data.id_comments_bak,
      tableBackup: data.table_backup,
    }, transaction);
  }

  async beginTransaction() {
    const transaction = new sql.Transaction(this.newPool);
    await transaction.begin();
    return transaction;
  }

  async commitTransaction(transaction) {
    if (!transaction) return;
    await transaction.commit();
  }

  async rollbackTransaction(transaction) {
    try {
      if (!transaction) return;
      await transaction.rollback();
    } catch {}
  }
}

module.exports = StreamCommentMigrationModel;
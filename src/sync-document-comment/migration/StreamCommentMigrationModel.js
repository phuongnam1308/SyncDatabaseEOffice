const BaseModel = require("../../../models/BaseModel");
const logger = require("../../../utils/logger");
const sql = require("mssql");
const MigrationHelper = require("../../helpers/MigrationHelper");

class StreamCommentMigrationModel extends BaseModel {
  constructor(oldDbTable) {
    super();
    this.oldDbSchema = "dbo";
    this.oldDbTable = oldDbTable;
    this.newDbSchema = "dbo";
    this.newDbTable = "document_comments_sync";
    this.helper = new MigrationHelper(this.queryNewDbTx.bind(this));
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

  async upsertBatch(records) {
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

    const id = `${Date.now()}${Math.random().toString(36).substring(2, 10)}`;

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
      `SELECT TOP 1 document_id FROM camunda.dbo.outgoing_documents_sync WHERE id_outgoing_bak = @id`,
      { id: normalized },
      transaction
    );
    if (outgoing?.length) return { document_id: outgoing[0].document_id, type_document: "OutgoingDocument" };

    const incoming = await this.queryNewDbTx(
      `SELECT TOP 1 document_id FROM camunda.dbo.incomming_documents2 WHERE id_incoming_bak = @id`,
      { id: normalized },
      transaction
    );
    if (incoming?.length) return { document_id: incoming[0].document_id, type_document: "IncommingDocument" };

    return null;
  }

  async _getExisting(mapped, transaction) {
    if (!mapped?.id_comments_bak) return null;
    const result = await this.queryNewDbTx(
      `SELECT TOP 1 id FROM camunda.dbo.document_comments_sync WHERE id_comments_bak = @bak AND table_backup = @table`,
      { bak: mapped.id_comments_bak, table: mapped.table_backup },
      transaction
    );
    return result?.[0] || null;
  }

  async _insert(data, transaction) {
    const query = `
      INSERT INTO camunda.dbo.document_comments_sync (
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
      UPDATE camunda.dbo.document_comments_sync
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

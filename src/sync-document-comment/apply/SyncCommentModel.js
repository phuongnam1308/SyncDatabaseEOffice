const BaseModel = require("../../../models/BaseModel");
const logger = require("../../../utils/logger");
const sql = require("mssql");

class SyncCommentModel extends BaseModel {
  constructor() {
    super();
    this.syncSchema = "dbo";
    this.syncTable = "document_comments_sync";
    this.mainSchema = "dbo";
    this.mainTable = "document_comments";
  }

  async getStatus() {
    const syncResult = await this.queryNewDbTx(
      `SELECT COUNT(*) AS total FROM camunda.${this.syncSchema}.${this.syncTable}`
    );
    const mainResult = await this.queryNewDbTx(
      `SELECT COUNT(*) AS total FROM camunda.${this.mainSchema}.${this.mainTable}`
    );
    const totalInSync = syncResult[0]?.total || 0;
    const totalInMain = mainResult[0]?.total || 0;
    return { totalInSync, totalInMain, remaining: totalInSync - totalInMain };
  }

  async fetchBatchFromSync({ batch, lastId = null }) {
    let query = `
      SELECT TOP (@batch) *
      FROM camunda.${this.syncSchema}.${this.syncTable}
      WHERE 1=1
    `;
    const params = { batch };
    if (lastId !== null && lastId !== undefined) {
      query += ` AND id > @lastId`;
      params.lastId = String(lastId);
    }
    query += ` ORDER BY id ASC`;
    return this.queryNewDbTx(query, params);
  }

  async insertBatchToMain(records) {
    if (!records?.length) return { inserted: 0, updated: 0 };

    let transaction = null;
    let inserted = 0;
    let updated = 0;

    try {
      transaction = await this.beginTransaction();

      for (const record of records) {
        try {
          const existing = await this.queryNewDbTx(
            `SELECT id FROM camunda.${this.mainSchema}.${this.mainTable}
             WHERE id_comments_bak = @bak AND table_bak = @table`,
            { bak: record.id_comments_bak, table: record.table_backup },
            transaction
          );

          if (existing?.length) {
            await this._updateRecord(record, transaction);
            updated++;
          } else {
            await this._insertRecord(record, transaction);
            inserted++;
          }
        } catch (err) {
          logger.warn(`[SyncCommentModel] Skip id=${record.id}: ${err.message}`);
        }
      }

      await this.commitTransaction(transaction);
      return { inserted, updated };
    } catch (error) {
      if (transaction) await this.rollbackTransaction(transaction);
      throw error;
    }
  }

  async _insertRecord(record, transaction) {
    const id = `${Date.now()}${Math.random().toString(36).substring(2, 10)}`;
    const query = `
      INSERT INTO camunda.${this.mainSchema}.${this.mainTable} (
        id, document_id, parent_id, user_id, user_name, content, [type],
        is_edited, created_at, updated_at, fileId, likes, is_leader_suggestion,
        id_comments_bak, document_id_bak, type_bak, table_bak,
        parent_id_bak, user_id_bak
      ) VALUES (
        @id, @documentId, @parentId, @userId, @userName, @content, @type,
        0, @createdAt, GETDATE(), @fileId, @likes, 0,
        @idCommentsBak, @documentIdBak, @typeBak, @tableBak,
        @parentIdBak, @userIdBak
      )
    `;
    await this.queryNewDbTx(query, this._mapParams(id, record), transaction);
  }

  async _updateRecord(record, transaction) {
    const query = `
      UPDATE camunda.${this.mainSchema}.${this.mainTable}
      SET
        document_id = @documentId,
        user_id = @userId,
        user_name = @userName,
        content = @content,
        [type] = @type,
        fileId = @fileId,
        likes = @likes,
        updated_at = GETDATE(),
        parent_id_bak = @parentIdBak
      WHERE id_comments_bak = @idCommentsBak AND table_bak = @tableBak
    `;
    await this.queryNewDbTx(query, this._mapParams(null, record), transaction);
  }

  _mapParams(id, record) {
    const p = {
      documentId: record.document_id ?? null,
      parentId: record.parent_id ?? null,
      userId: record.user_id ?? null,
      userName: record.user_name ?? null,
      content: record.content ?? "",
      type: record.type ?? null,
      createdAt: record.created_at ?? null,
      fileId: record.file_id ?? null,
      likes: record.likes ?? null,
      idCommentsBak: record.id_comments_bak ?? null,
      documentIdBak: record.document_id_bak ?? null,
      typeBak: record.type_bak ?? null,
      tableBak: record.table_backup ?? null,
      parentIdBak: record.parent_id_bak ?? null,
      userIdBak: record.user_id_bak ?? null,
    };
    if (id) p.id = id;
    return p;
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

module.exports = SyncCommentModel;

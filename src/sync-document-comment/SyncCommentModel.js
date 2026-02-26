const BaseModel = require("../../models/BaseModel");
const logger = require("../../utils/logger");

class SyncCommentModel extends BaseModel {
  constructor() {
    super();
    this.syncSchema = "dbo";
    this.syncTable = "document_comments_sync";
    this.mainSchema = "dbo";
    this.mainTable = "document_comments";
  }

  async applySingleRecord(record, transaction) {
    if (!record) return { inserted: 0, updated: 0 };

    if (!transaction) {
      throw new Error("Transaction is required for applySingleRecord");
    }

    if (!record.id_comments_bak || !record.table_backup) {
      logger.warn(
        `[SyncCommentModel.applySingleRecord] Missing bak fields id=${record?.id}`
      );
      return { inserted: 0, updated: 0 };
    }

    let inserted = 0;
    let updated = 0;

    try {
      const existing = await this.queryNewDbTx(
        `SELECT id FROM ${process.env.NEW_DB_NAME}.${this.mainSchema}.${this.mainTable}
         WHERE id_comments_bak = @bak AND table_bak = @table`,
        {
          bak: record.id_comments_bak,
          table: record.table_backup,
        },
        transaction
      );

      if (existing?.length) {
        await this._updateRecord(record, transaction);
        updated++;
      } else {
        await this._insertRecord(record, transaction);
        inserted++;
      }

      return { inserted, updated };
    } catch (error) {
      logger.error(
        `[SyncCommentModel.applySingleRecord] Error record id=${record?.id}`,
        error
      );
      throw error; // không rollback ở đây
    }
  }

  async insertBatchToMain(records, transaction) {
    if (!records?.length) return { inserted: 0, updated: 0 };

    if (!transaction) {
      throw new Error("Transaction is required for insertBatchToMain");
    }

    let inserted = 0;
    let updated = 0;

    for (const record of records) {
      if (!record?.id_comments_bak || !record?.table_backup) {
        logger.warn(`[SyncCommentModel] Skip invalid record id=${record?.id}`);
        continue;
      }

      try {
        const existing = await this.queryNewDbTx(
          `SELECT id FROM ${process.env.NEW_DB_NAME}.${this.mainSchema}.${this.mainTable}
           WHERE id_comments_bak = @bak AND table_bak = @table`,
          {
            bak: record.id_comments_bak,
            table: record.table_backup,
          },
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
        logger.warn(
          `[SyncCommentModel.insertBatchToMain] Skip id=${record?.id}: ${err.message}`
        );
      }
    }

    return { inserted, updated };
  }

  async _insertRecord(record, transaction) {
    const id = `${Date.now()}${Math.random()
      .toString(36)
      .substring(2, 10)}`;

    const query = `
      INSERT INTO ${process.env.NEW_DB_NAME}.${this.mainSchema}.${this.mainTable} (
        id, document_id, parent_id, user_id, user_name, content, [type],
        is_edited, created_at, updated_at, fileId, likes, is_leader_suggestion,
        id_comments_bak, type_bak, table_bak,
        parent_id_bak, user_id_bak
      ) VALUES (
        @id, @documentId, @parentId, @userId, @userName, @content, @type,
        0, @createdAt, GETDATE(), @fileId, @likes, 0,
        @idCommentsBak, @typeBak, @tableBak,
        @parentIdBak, @userIdBak
      )
    `;

    await this.queryNewDbTx(
      query,
      this._mapParams(id, record),
      transaction
    );
  }

  async _updateRecord(record, transaction) {
    const query = `
      UPDATE ${process.env.NEW_DB_NAME}.${this.mainSchema}.${this.mainTable}
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
      WHERE id_comments_bak = @idCommentsBak
        AND table_bak = @tableBak
    `;

    await this.queryNewDbTx(
      query,
      this._mapParams(null, record),
      transaction
    );
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
      typeBak: record.type_bak ?? null,
      tableBak: record.table_backup ?? null,
      parentIdBak: record.parent_id_bak ?? null,
      userIdBak: record.user_id_bak ?? null,
    };

    if (id) p.id = id;
    return p;
  }
}

module.exports = SyncCommentModel;
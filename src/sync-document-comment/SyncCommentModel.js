const BaseModel = require("../../models/BaseModel");
const logger = require("../../utils/logger");
const MigrationHelper = require("../helpers/MigrationHelper");

class StreamCommentMigrationModel extends BaseModel {
  constructor(oldDbTable) {
    super();
    this.oldDbSchema = "dbo";
    this.oldDbTable = oldDbTable;
    this.newDbSchema = "dbo";
    this.newDbTable = "document_comments";
    this.helper = new MigrationHelper(this.queryNewDbTx.bind(this), this.queryOldDb.bind(this));
  }

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

  async processSingleRecord(rawRecord, documentId, transaction) {
    if (!transaction) {
      throw new Error("Transaction is required from parent");
    }

    if (!rawRecord?.ID) {
      return { inserted: 0, updated: 0 };
    }

    let inserted = 0;
    let updated = 0;

    try {
      const mapped = await this._mapRecord(
        rawRecord,
        documentId,
        transaction
      );

      if (!mapped) {
        return { inserted: 0, updated: 0 };
      }
      const existed = await this._getExistingInMain(
        mapped,
        transaction
      );

      if (existed) {
        await this._update(mapped, transaction);
        updated = 1;
      } else {
        await this._insert(mapped, transaction);
        inserted = 1;
      }

      return { inserted, updated };
    } catch (error) {
      logger.error(
        `[StreamCommentMigrationModel.processSingleRecord] table=${this.oldDbTable} ID=${rawRecord?.ID}:`,
        error
      );
      throw error;
    }
  }

  async _mapRecord(record, documentId, transaction) {
    if (!record?.ID) return null;

    const userId = await this.helper.mapUserName(record.Author, transaction);
    const userName = this.helper.extractDisplayName(record.Author);

    const id = Date.now();

    return {
      id,
      document_id: documentId || null,
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

  async _getExistingInMain(mapped, transaction) {
    if (!mapped?.id_comments_bak) return null;

    const result = await this.queryNewDbTx(
      `SELECT TOP 1 id 
      FROM ${process.env.NEW_DB_NAME}.dbo.document_comments
      WHERE id_comments_bak = @bak 
        AND table_bak = @table`,
      {
        bak: mapped.id_comments_bak,
        table: mapped.table_backup,
      },
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
}

module.exports = StreamCommentMigrationModel;
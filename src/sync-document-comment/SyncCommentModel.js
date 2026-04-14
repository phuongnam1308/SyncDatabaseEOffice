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

    const userName = this.helper.extractDisplayName(record.Author);
    const userId = await this.helper.mapUserName(userName, transaction);

    const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    return {
      id,
      document_id: documentId || null,
      parent_id: null,
      user_id: userId || null,
      user_name: userName,
      content: record.Content || "",
      type: record.Type ? String(record.Type) : null,
      is_edited: 0,
      created_at: this.helper.parseDate(record.Created),
      fileId: record.Files || null,
      likes: record.LikeNumber ? String(record.LikeNumber) : null,
      is_leader_suggestion: 0,
      org_id: null,
      id_comments_bak: String(record.ID),
      table_bak: this.oldDbTable,
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
        table: mapped.table_bak,
      },
      transaction
    );

    return result?.[0] || null;
  }

  async _insert(data, transaction) {
    const query = `
      INSERT INTO ${process.env.NEW_DB_NAME}.dbo.document_comments (
        id, document_id, parent_id, user_id, user_name, content, [type],
        is_edited, created_at, updated_at, fileId, likes, is_leader_suggestion,
        org_id, id_comments_bak, table_bak
      ) VALUES (
        @id, @documentId, NULL, @userId, @userName, @content, @type,
        @isEdited, @createdAt, GETDATE(), @fileId, @likes, @isLeaderSuggestion,
        @orgId, @idCommentsBak, @tableBak
      )
    `;
    await this.queryNewDbTx(query, {
      id: data.id,
      documentId: data.document_id,
      userId: data.user_id,
      userName: data.user_name,
      content: data.content,
      type: data.type,
      isEdited: data.is_edited,
      createdAt: data.created_at,
      fileId: data.fileId,
      likes: data.likes,
      isLeaderSuggestion: data.is_leader_suggestion,
      orgId: data.org_id,
      idCommentsBak: data.id_comments_bak,
      tableBak: data.table_bak,
    }, transaction);
  }

  async _update(data, transaction) {
    const query = `
      UPDATE ${process.env.NEW_DB_NAME}.dbo.document_comments
      SET
        document_id = @documentId,
        user_id = @userId,
        user_name = @userName,
        content = @content,
        [type] = @type,
        fileId = @fileId,
        likes = @likes,
        updated_at = GETDATE()
      WHERE id_comments_bak = @idCommentsBak AND table_bak = @tableBak
    `;
    await this.queryNewDbTx(query, {
      documentId: data.document_id,
      userId: data.user_id,
      userName: data.user_name,
      content: data.content,
      type: data.type,
      fileId: data.fileId,
      likes: data.likes,
      idCommentsBak: data.id_comments_bak,
      tableBak: data.table_bak,
    }, transaction);
  }
}

module.exports = StreamCommentMigrationModel;
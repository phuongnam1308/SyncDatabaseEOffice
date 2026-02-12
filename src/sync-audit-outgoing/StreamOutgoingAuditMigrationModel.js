const logger = require("../../utils/logger");
const sql = require('mssql');
const BaseModel = require("../../models/BaseModel");

class StreamOutgoingAuditSyncModel extends BaseModel {
  constructor(oldDbTable) {
    super();
    this.oldDbSchema = "dbo";
    this.oldDbTable = oldDbTable;
    this.newDbSchema = "dbo";
    this.newDbTable = "audit_sync";
  }

  /* ================= FETCH ================= */

  async fetchBatch({ batch, lastId }) {
    const query = `
      SELECT TOP (@batch) *
      FROM ${this.oldDbSchema}.${this.oldDbTable}
      WHERE (@lastId IS NULL OR ID > @lastId)
      ORDER BY ID ASC
    `;

    return this.queryOldDb(query, {
      batch,
      lastId: lastId || null,
    });
  }

  /* ================= UPSERT ================= */

  async upsertBatch(records) {
    if (!records?.length) return { inserted: 0, updated: 0 };

    const transaction = await this.beginTransaction();

    let inserted = 0;
    let updated = 0;

    try {
      for (const raw of records) {
        try {
          const mapped = await this._mapSingleRecord(raw, transaction);
          if (!mapped) continue;

          const existed = await this._getExistingAuditSync(
            mapped.id_van_ban,
            transaction
          );

          if (existed) {
            await this._update(mapped, transaction);
            updated++;
          } else {
            await this._insert(mapped, transaction);
            inserted++;
          }
        } catch (err) {
          logger.warn(
            `[AuditSync:${this.oldDbTable}] Skip ID=${raw?.ID}: ${err.message}`
          );
        }
      }

      await this.commitTransaction(transaction);

      return { inserted, updated };
    } catch (error) {
      await this.rollbackTransaction(transaction);
      throw error;
    }
  }

  /* ================= MAP ================= */

  async _mapSingleRecord(record, transaction) {
    if (!record?.ID || !record?.IDVanBan) return null;

    const documentId = await this._getNewDocumentId(
      record.IDVanBan,
      transaction
    );

    if (!documentId) return null;

    const user = await this._mapUserName(record.NguoiXuLy, transaction);

    return {
      id_van_ban: String(record.ID),
      document_id: documentId,
      time: this._parseDate(record.NgayTao),
      action_code: record.HanhDong || null,
      display_name: user.name,
      user_id: user.id,
    };
  }

  async _mapUserName(name, transaction) {
    if (!name) return { id: null, name: null };

    try {
      const query = `
        SELECT TOP 1 id, name
        FROM camunda.dbo.users
        WHERE name = @name
      `;

      const result = await this.queryNewDbTx(
        query,
        { name },
        transaction
      );

      if (result?.length) {
        return {
          id: result[0].id,
          name: result[0].name,
        };
      }

      return { id: null, name };
    } catch (error) {
      logger.warn(`Map user fail: ${name}`);
      return { id: null, name };
    }
  }

  _parseDate(date) {
    if (!date) return null;
    const d = new Date(date);
    return isNaN(d.getTime()) ? null : d;
  }

  /* ================= EXIST CHECK ================= */

  async _getExistingAuditSync(idVanBan, transaction) {
    const query = `
      SELECT TOP 1 id
      FROM camunda.dbo.audit_sync
      WHERE id_van_ban = @idVanBan
    `;

    const result = await this.queryNewDbTx(
      query,
      { idVanBan },
      transaction
    );

    return result?.[0] || null;
  }

  /* ================= INSERT ================= */

  async _insert(data, transaction) {
    const query = `
      INSERT INTO camunda.dbo.audit_sync (
        document_id,
        time,
        display_name,
        user_id,
        action_code,
        id_van_ban,
        created_at,
        updated_at,
        type_document,
        table_backups
      )
      VALUES (
        @documentId,
        @time,
        @displayName,
        @userId,
        @actionCode,
        @idVanBan,
        GETDATE(),
        GETDATE(),
        'OUTGOING',
        @sourceTable
      )
    `;

    await this.queryNewDbTx(
      query,
      {
        documentId: data.document_id,
        time: data.time,
        displayName: data.display_name,
        userId: data.user_id,
        actionCode: data.action_code,
        idVanBan: data.id_van_ban,
        sourceTable: this.oldDbTable,
      },
      transaction
    );
  }

  /* ================= UPDATE ================= */

  async _update(data, transaction) {
    const query = `
      UPDATE camunda.dbo.audit_sync
      SET
        document_id = @documentId,
        time = @time,
        display_name = @displayName,
        user_id = @userId,
        action_code = @actionCode,
        updated_at = GETDATE()
      WHERE id_van_ban = @idVanBan
    `;

    await this.queryNewDbTx(
      query,
      {
        documentId: data.document_id,
        time: data.time,
        displayName: data.display_name,
        userId: data.user_id,
        actionCode: data.action_code,
        idVanBan: data.id_van_ban,
      },
      transaction
    );
  }
  
  // ========================================================================
  // TRANSACTION METHODS
  // ========================================================================

  /**
   * Bắt đầu transaction
   * @returns {Promise<Object>} Transaction object
   */
  async beginTransaction() {
    try {
      const transaction = new sql.Transaction(this.newPool);
      await transaction.begin();
      logger.debug("[beginTransaction] Started");
      return transaction;
    } catch (error) {
      logger.error("[beginTransaction] Error:", error);
      throw error;
    }
  }

  async commitTransaction(transaction) {
    try {
      if (!transaction) return;
      await transaction.commit();
      logger.debug("[commitTransaction] Committed");
    } catch (error) {
      logger.error("[commitTransaction] Error:", error);
      throw error;
    }
  }

  async rollbackTransaction(transaction) {
    try {
      if (!transaction) return;
      await transaction.rollback();
      logger.debug("[rollbackTransaction] Rolled back");
    } catch (error) {
      logger.error("[rollbackTransaction] Error:", error);
    }
  }
}

module.exports = StreamOutgoingAuditSyncModel;

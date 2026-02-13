// sync-audit.model.js
const BaseModel = require("../../../models/BaseModel");
const logger = require("../../../utils/logger");
const sql = require('mssql');

class SyncAuditModel extends BaseModel {
  constructor() {
    super();
    this.syncSchema = "dbo";
    this.syncTable = "audit_sync";
    this.mainSchema = "dbo";
    this.mainTable = "audit";
  }

  async getStatus() {
    try {
      const countSyncQuery = `
        SELECT COUNT(*) AS total
        FROM camunda.${this.syncSchema}.${this.syncTable}
      `;
      const syncResult = await this.queryNewDbTx(countSyncQuery);
      const totalInSync = syncResult[0]?.total || 0;

      const countMainQuery = `
        SELECT COUNT(*) AS total
        FROM camunda.${this.mainSchema}.${this.mainTable}
      `;
      const mainResult = await this.queryNewDbTx(countMainQuery);
      const totalInMain = mainResult[0]?.total || 0;

      return {
        totalInSync,
        totalInMain,
        remaining: totalInSync - totalInMain,
      };
    } catch (error) {
      logger.error("[SyncAuditModel.getStatus] Error:", error);
      throw error;
    }
  }

  async fetchBatchFromSync({ batch, lastId = null }) {
    try {
      let query = `
        SELECT TOP (@batch) *
        FROM camunda.${this.syncSchema}.${this.syncTable}
        WHERE 1=1
      `;

      const params = { batch };

      if (lastId !== null && lastId !== undefined) {
        query += ` AND id > @lastId`;
        params.lastId = lastId;
      }

      query += ` ORDER BY id ASC`;

      const records = await this.queryNewDbTx(query, params);
      logger.debug(`[fetchBatchFromSync] lastId=${lastId} → fetched ${records.length}`);

      return records;
    } catch (error) {
      logger.error("[fetchBatchFromSync] Error:", error);
      throw error;
    }
  }

  async insertBatchToMain(records) {
    if (!records || records.length === 0) {
      return { inserted: 0, updated: 0 };
    }

    let transaction = null;
    let inserted = 0;
    let updated = 0;

    try {
      transaction = await this.beginTransaction();

      for (const record of records) {
        try {
          const existingQuery = `
            SELECT id FROM camunda.${this.mainSchema}.${this.mainTable}
            WHERE document_id = @documentId 
              AND [time] = @time
              AND user_id = @userId
          `;
          const existing = await this.queryNewDbTx(
            existingQuery,
            { 
              documentId: record.document_id,
              time: record.time,
              userId: record.user_id
            },
            transaction
          );

          if (existing && existing.length > 0) {
            await this._updateRecord(record, transaction);
            updated++;
          } else {
            await this._insertRecord(record, transaction);
            inserted++;
          }
        } catch (recordError) {
          logger.warn(`[insertBatchToMain] Skip record id=${record.id}:`, recordError.message);
        }
      }

      await this.commitTransaction(transaction);
      logger.debug(`[insertBatchToMain] Inserted: ${inserted}, Updated: ${updated}`);

      return { inserted, updated };
    } catch (error) {
      if (transaction) {
        await this.rollbackTransaction(transaction);
        logger.error("[insertBatchToMain] Transaction rolled back");
      }
      logger.error("[SyncAuditModel.insertBatchToMain] Error:", error);
      throw error;
    }
  }

  async _insertRecord(record, transaction) {
    const query = `
      INSERT INTO camunda.${this.mainSchema}.${this.mainTable} (
        document_id, [time], user_id, display_name, [role],
        action_code, from_node_id, to_node_id, details, origin_id,
        created_by, receiver, receiver_unit, group_, roleProcess,
        [action], deadline, stage_status, curStatusCode, created_at,
        updated_at, type_document, processed_by, table_backups, acting_as
      )
      VALUES (
        @document_id, @time, @user_id, @display_name, @role,
        @action_code, @from_node_id, @to_node_id, @details, @origin_id,
        @created_by, @receiver, @receiver_unit, @group_, @roleProcess,
        @action, @deadline, @stage_status, @curStatusCode, @created_at,
        @updated_at, @type_document, @processed_by, @table_backups, @acting_as
      )
    `;

    const params = this._mapRecordParams(record);
    await this.queryNewDbTx(query, params, transaction);
  }

  async _updateRecord(record, transaction) {
    const query = `
      UPDATE camunda.${this.mainSchema}.${this.mainTable}
      SET
        display_name = @display_name,
        [role] = @role,
        action_code = @action_code,
        from_node_id = @from_node_id,
        to_node_id = @to_node_id,
        details = @details,
        origin_id = @origin_id,
        created_by = @created_by,
        receiver = @receiver,
        receiver_unit = @receiver_unit,
        group_ = @group_,
        roleProcess = @roleProcess,
        [action] = @action,
        deadline = @deadline,
        stage_status = @stage_status,
        curStatusCode = @curStatusCode,
        updated_at = GETDATE(),
        type_document = @type_document,
        processed_by = @processed_by,
        table_backups = @table_backups,
        acting_as = @acting_as
      WHERE document_id = @document_id
        AND [time] = @time
        AND user_id = @user_id
    `;

    const params = this._mapRecordParams(record);
    await this.queryNewDbTx(query, params, transaction);
  }

  _mapRecordParams(record) {
    return {
      document_id: record.document_id ?? null,
      time: record.time ?? null,
      user_id: record.user_id ?? null,
      display_name: record.display_name ?? null,
      role: record.role ?? null,
      action_code: record.action_code ?? null,
      from_node_id: record.from_node_id ?? null,
      to_node_id: record.to_node_id ?? null,
      details: record.details ?? null,
      origin_id: record.origin_id ?? null,
      created_by: record.created_by ?? null,
      receiver: '6915f2387e39c2ba33cef79a' ?? null,
      receiver_unit: record.receiver_unit ?? null,
      group_: record.group_ ?? null,
      roleProcess: record.roleProcess ?? null,
      action: record.action ?? null,
      deadline: record.deadline ?? null,
      stage_status: record.stage_status ?? null,
      curStatusCode: record.curStatusCode ?? null,
      created_at: record.created_at ?? null,
      updated_at: record.updated_at ?? null,
      type_document: record.type_document ?? null,
      processed_by: record.processed_by ?? null,
      table_backups: record.table_backup ?? null,
      acting_as: record.acting_as ?? null,
    };
  }

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

module.exports = SyncAuditModel;
const BaseModel = require("../../../models/BaseModel");
const logger = require("../../../utils/logger");
const sql = require('mssql');
const MigrationHelper = require("../../helpers/MigrationHelper");

class StreamOutgoingAuditSyncModel extends BaseModel {
  constructor(oldDbTable) {
    super();
    this.oldDbSchema = "dbo";
    this.oldDbTable = oldDbTable;
    this.newDbSchema = "dbo";
    this.newDbTable = "audit_sync";
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
          const mapped = await this._mapSingleRecord(raw, transaction);
          if (!mapped) continue;
          const audits = this.helper._expandMappedRecords(mapped);

          for (const audit of audits) {
            const existed = await this._getExistingAuditSync(audit, transaction);

            if (existed) {
              await this._update(audit, transaction);
              updated++;
            } else {
              await this._insert(audit, transaction);
              inserted++;
            }
          }
        } catch (err) {
          logger.warn(`[AuditSync:${this.oldDbTable}] Skip ID=${raw?.ID}: ${err.message}`);
        }
      }

      await this.commitTransaction(transaction);

      return { inserted, updated };
    } catch (error) {
      await this.rollbackTransaction(transaction);
      throw error;
    }
  }

  async _mapSingleRecord(record, transaction) {
    if (!record?.ID || !record?.IDVanBan) return null;

    const documentId = await this._getNewDocumentId(record.IDVanBan, transaction);

    if (!documentId) return null;

    const user_id = await this.helper.mapUserName(record.NguoiXuLy, transaction);
    const userName = this.helper.extractDisplayName(record.NguoiXuLy);
    const actionParsed = this.helper.parseActionString(
      user_id,
      record.HanhDong
    ) || {};

    let receiverArray = null;
    if (Array.isArray(actionParsed.receiver) && actionParsed.receiver.length) {
      const uniqueReceivers = [
        ...new Set(
          actionParsed.receiver
            .map((x) => (x ? String(x).trim() : null))
            .filter(Boolean)
        ),
      ];
      const mappedResults = [];
      for (const username of uniqueReceivers) {
        const mappedUser = await this.helper.mapUserName(
          username,
          transaction
        );
        if (mappedUser) {
          mappedResults.push(String(mappedUser));
        }
      }
      receiverArray = mappedResults.length ? mappedResults : null;
    }

    let receiverUnitArray = null;
    if (Array.isArray(actionParsed.receiver_unit) && actionParsed.receiver_unit.length) {
      const uniqueReceiverUnits = [
        ...new Set(
          actionParsed.receiver_unit
            .map((x) => (x ? String(x).trim() : null))
            .filter(Boolean)
        ),
      ];
      const mappedResults = [];
      for (const unitname of uniqueReceiverUnits) {
        const mappedUnit = await this.helper.mapSenderUnitId(
          unitname,
          transaction
        );
        if (mappedUnit) {
          mappedResults.push(String(mappedUnit));
        }
      }
      receiverUnitArray = mappedResults.length ? mappedResults : null;
    }

    return {
      id_van_ban: String(record.ID),
      document_id: documentId,
      time: this.helper.parseDate(record.NgayTao),
      action_code: actionParsed.action_code || null,
      receiver: receiverArray || [],
      receiver_unit: receiverUnitArray || [],
      display_name: userName,
      user_id: user_id,
    };
  }

  async _getExistingAuditSync(audit, transaction) {
    if (!transaction) {
      throw new Error('_getExistingAuditSync requires transaction');
    }

    if (!audit?.id_van_ban) return null;

    if (!audit.receiver && !audit.receiver_unit) return null;

    let query = `
      SELECT TOP 1 id
      FROM camunda.dbo.audit_sync
      WHERE id_van_ban = @idVanBan
    `;

    const params = {
      idVanBan: audit.id_van_ban,
    };

    if (audit.receiver) {
      query += ` AND receiver = @receiver`;
      params.receiver = audit.receiver;
    }

    if (audit.receiver_unit) {
      query += ` AND receiver_unit = @receiverUnit`;
      params.receiverUnit = audit.receiver_unit;
    }

    const result = await this.queryNewDbTx(query, params, transaction);

    return result?.[0] || null;
  }

  async _getNewDocumentId(idVanBan, transaction = null) {
    try {
      if (idVanBan === null || idVanBan === undefined) {
        return { document_id: null, type_document: null };
      }

      const normalizedIdVanBan = String(idVanBan).trim();
      if (!normalizedIdVanBan) {
        return { document_id: null, type_document: null };
      }

      const outgoingQuery = `
        SELECT TOP 1 document_id
        FROM camunda.dbo.outgoing_documents_sync
        WHERE id_outgoing_bak = @idVanBan
      `;

      const outgoing = await this.queryNewDbTx(outgoingQuery, { idVanBan: normalizedIdVanBan }, transaction);

      if (outgoing?.length) {
        return {
          document_id: outgoing[0].document_id,
          type_document: 'OutgoingDocument',
        };
      }

      const incomingQuery2 = `
        SELECT TOP 1 document_id
        FROM camunda.dbo.incomming_documents2
        WHERE id_incoming_bak = @idVanBan
      `;

      const incoming2 = await this.queryNewDbTx(incomingQuery2, { idVanBan: normalizedIdVanBan }, transaction);

      if (incoming2?.length) {
        return {
          document_id: incoming2[0].document_id,
          type_document: 'IncommingDocument',
        };
      }

      return { document_id: null, type_document: null };

    } catch (error) {
      logger.error(`[_getNewDocumentId] Error idVanBan=${idVanBan}: ${error.message}`);
      throw error;
    }
  }

  async _insert(data, transaction) {
    if (!data?.document_id?.document_id) {
      logger.warn(`[audit_sync] Skip insert vì document_id null | id_van_ban=${data?.id_van_ban}`);
      return;
    }

    const query = `
      INSERT INTO camunda.dbo.audit_sync (
        document_id, time, display_name, user_id, created_by,
        receiver, receiver_unit, action_code,
        id_van_ban, created_at, updated_at, type_document, table_backup
      )
      VALUES (
        @documentId, @time, @displayName, @userId, @createdBy,
        @receiver, @receiverUnit, @actionCode,
        @idVanBan, @time, GETDATE(), @typeDocument, @sourceTable
      )
    `;

    await this.queryNewDbTx(query, {
      documentId: data.document_id.document_id,
      time: data.time,
      displayName: data.display_name,
      userId: '6915f2387e39c2ba33cef79a',
      createdBy: data.user_id,

      receiver: data.receiver,
      receiverUnit: data.receiver_unit,
      actionCode: data.action_code,

      idVanBan: data.id_van_ban,
      typeDocument: data.document_id.type_document,
      sourceTable: this.oldDbTable,
    }, transaction);
  }

  async _update(data, transaction) {
    const query = `
      UPDATE camunda.dbo.audit_sync
      SET
        time = @time, display_name = @displayName, user_id = @userId,
        created_by = @createBy, action_code = @actionCode, receiver = @receiver, receiver_unit = @receiverUnit,
        updated_at = GETDATE()
      WHERE id_van_ban = @idVanBan
    `;

    await this.queryNewDbTx(query, {
      time: data.time,
      displayName: data.display_name,
      userId: '6915f2387e39c2ba33cef79a',
      createBy: data.user_id,
      actionCode: data.action_code,      
      receiver: data.receiver,
      receiverUnit: data.receiver_unit,
      idVanBan: data.id_van_ban,
    }, transaction);
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

module.exports = StreamOutgoingAuditSyncModel;
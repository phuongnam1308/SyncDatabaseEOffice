const BaseModel = require("../../../models/BaseModel");
const logger = require("../../../utils/logger");
const sql = require('mssql');
const MigrationHelper = require("../../helpers/MigrationHelper");

// ── Danh sách bảng audit trong DB cũ ─────────────────────────
const AUDIT_TABLES = [
  'LuanChuyenVanBan',
  'LuanChuyenVanBan_ATPC',
  'LuanChuyenVanBan_CLL',
  'LuanChuyenVanBan_CNTT',
  'LuanChuyenVanBan_CT',
  'LuanChuyenVanBan_CVTC',
  'LuanChuyenVanBan_DonVi',
  'LuanChuyenVanBan_DVHH',
  'LuanChuyenVanBan_DVKT',
  'LuanChuyenVanBan_GNVT',
  'LuanChuyenVanBan_HC',
  'LuanChuyenVanBan_HT',
  'LuanChuyenVanBan_ICDLB',
  'LuanChuyenVanBan_ICDST',
  'LuanChuyenVanBan_KHDT',
  'LuanChuyenVanBan_KHKD',
  'LuanChuyenVanBan_KTVT',
  'LuanChuyenVanBan_KVTC',
  'LuanChuyenVanBan_MKT',
  'LuanChuyenVanBan_NPL',
  'LuanChuyenVanBan_QLCT',
  'LuanChuyenVanBan_QSBV',
  'LuanChuyenVanBan_SNPL',
  'LuanChuyenVanBan_TC',
  'LuanChuyenVanBan_TC189',
  'LuanChuyenVanBan_TCCT',
  'LuanChuyenVanBan_TCHP',
  'LuanChuyenVanBan_TCIDI',
  'LuanChuyenVanBan_TCLD',
  'LuanChuyenVanBan_TCMT',
  'LuanChuyenVanBan_TCO',
  'LuanChuyenVanBan_TCOT',
  'LuanChuyenVanBan_TCPC',
  'LuanChuyenVanBan_TCPH',
  'LuanChuyenVanBan_TCTT',
  'LuanChuyenVanBan_TTDDC',
  'LuanChuyenVanBan_TTDTC',
  'LuanChuyenVanBan_VP',
  'LuanChuyenVanBan_VPMB',
  'LuanChuyenVanBan_VPTNB',
  'LuanChuyenVanBan_VTB',
  'LuanChuyenVanBan_VTT',
  'LuanChuyenVanBan_XDCT',
  'LuanChuyenVanBan_xdsm',
  'LuanChuyenVanBan_XNCG',
  'LuanChuyenVanBan_YTE',
];
class StreamOutgoingAuditSyncModel extends BaseModel {
  constructor(oldDbTable) {
    super();
    this.oldDbSchema = "dbo";
    this.oldDbTable = oldDbTable;
    this.newDbSchema = "dbo";
    this.newDbTable = "audit_sync";
    this.helper = new MigrationHelper(this.queryNewDbTx.bind(this));
  }

  // Hàm fetch batch từ DB cũ, vẫn giữ nguyên để chạy theo batch nếu cần, nhưng ưu tiên dùng fetchByDocumentId cho từng văn bản cụ thể
  async fetchBatch({ batch, lastId }) {
    const query = `
      SELECT TOP (@batch) *
      FROM ${this.oldDbSchema}.${this.oldDbTable}
      WHERE (@lastId IS NULL OR ID > @lastId)
      ORDER BY ID ASC
    `;

    return this.queryOldDb(query, { batch, lastId: lastId || null });
  }

  // Hàm migrate batch, vẫn giữ nguyên để chạy theo batch nếu cần, nhưng ưu tiên dùng processSingleRecord cho từng bản ghi
  async insertBatchToNewDb(records) {
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
            try {
              const existed = await this._getExistingAuditSync(audit, transaction);

              if (existed) {
                await this._update(audit, transaction);
                updated++;
              } else {
                await this._insert(audit, transaction);
                inserted++;
              }
            } catch (auditErr) {
              logger.warn(
                `[AuditSync:${this.oldDbTable}] Skip audit id_van_ban=${audit?.id_van_ban} receiver=${audit?.receiver}: ${auditErr.message}`
              );
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

  /**
   * Lấy tất cả bản ghi audit liên quan đến một văn bản cụ thể từ bảng cũ.
   * Được gọi bởi document migration model để truy vấn audit theo oldDocumentId.
   */
  async fetchByDocumentId(oldDocumentId) {
    if (!oldDocumentId) return [];
    try {
      const query = `
        SELECT *
        FROM ${this.oldDbSchema}.${this.oldDbTable}
        WHERE IDVanBan = @oldDocumentId
        ORDER BY ID ASC
      `;
      return this.queryOldDb(query, { oldDocumentId: String(oldDocumentId) });
    } catch (error) {
      logger.error(`[StreamOutgoingAuditSyncModel.fetchByDocumentId] table=${this.oldDbTable} id=${oldDocumentId}:`, error);
      throw error;
    }
  }

  /**
   * Migrate một bản ghi audit đơn lẻ từ DB cũ sang bảng audit_sync.
   * Được gọi bởi document migration model thay vì xử lý theo batch.
   */
  async processSingleRecord(rawRecord, externalTransaction = null) {
    if (!rawRecord) return null;

    const transaction = externalTransaction || await this.beginTransaction();
    const ownsTransaction = !externalTransaction;
    const syncedRecords = [];

    try {
      const mapped = await this._mapSingleRecord(rawRecord, transaction);
      if (!mapped) {
        if (ownsTransaction) await this.commitTransaction(transaction);
        return null;
      }

      const audits = this.helper._expandMappedRecords(mapped);

      for (const audit of audits) {
        try {
          const existed = await this._getExistingAuditSync(audit, transaction);

          if (existed) {
            await this._update(audit, transaction);
          } else {
            await this._insert(audit, transaction);
          }

          // Trả về bản ghi đã được sync để caller có thể tiếp tục apply vào bảng chính
          syncedRecords.push({
            ...audit,
            _existed: !!existed,
          });
        } catch (auditErr) {
          logger.warn(
            `[AuditSync:${this.oldDbTable}] processSingleRecord skip audit id_van_ban=${audit?.id_van_ban} receiver=${audit?.receiver}: ${auditErr.message}`
          );
        }
      }

      if (ownsTransaction) await this.commitTransaction(transaction);
      return syncedRecords;
    } catch (error) {
      if (ownsTransaction) await this.rollbackTransaction(transaction);
      logger.error(`[StreamOutgoingAuditSyncModel.processSingleRecord] table=${this.oldDbTable} ID=${rawRecord?.ID}:`, error);
      throw error;
    }
  }

  async _insert(data, transaction) {
    if (!data?.document_id?.document_id) {
      logger.warn(`[audit_sync] Skip insert vì document_id null | id_van_ban=${data?.id_van_ban}`);
      return;
    }

    const receiver = this._normalizeArrayField(data.receiver);
    const receiverUnit = this._normalizeArrayField(data.receiver_unit);

    const query = `
      INSERT INTO ${process.env.NEW_DB_NAME}.${newDbSchema}.${newDbTable} (
        document_id, time, display_name, user_id, created_by,
        receiver, receiver_unit, action_code, roleProcess, stage_status,
        id_van_ban, created_at, updated_at, type_document, table_backup
      )
      VALUES (
        @documentId, @time, @displayName, @userId, @createdBy,
        @receiver, @receiverUnit, @actionCode, @roleProcess, @stageStatus,
        @idVanBan, @time, GETDATE(), @typeDocument, @sourceTable
      )
    `;

    await this.queryNewDbTx(query, {
      documentId: data.document_id.document_id,
      time: data.time,
      displayName: data.display_name,
      userId: data.user_id || '6915f2387e39c2ba33cef79a',
      createdBy: data.user_id,
      receiver,
      receiverUnit,
      actionCode: data.action_code,
      roleProcess: data.roleProcess || null,
      stageStatus: data.stage_status || null,
      idVanBan: data.id_van_ban,
      typeDocument: data.document_id.type_document,
      sourceTable: this.oldDbTable,
    }, transaction);
  }

  async _update(data, transaction) {
    const receiver = this._normalizeArrayField(data.receiver);
    const receiverUnit = this._normalizeArrayField(data.receiver_unit);

    let whereClause = `WHERE id_van_ban = @idVanBan`;
    const params = {
      time: data.time,
      displayName: data.display_name,
      userId: '6915f2387e39c2ba33cef79a',
      createBy: data.user_id,
      actionCode: data.action_code,
      receiver,
      receiverUnit,
      roleProcess: data.roleProcess || null,
      stageStatus: data.stage_status || null,
      idVanBan: data.id_van_ban,
    };

    if (receiver) {
      whereClause += ` AND receiver = @receiver`;
    }

    if (receiverUnit) {
      whereClause += ` AND receiver_unit = @receiverUnit`;
    }

    const query = `
      UPDATE ${process.env.NEW_DB_NAME}.${newDbSchema}.${newDbTable}
      SET
        time = @time, display_name = @displayName, user_id = @userId,
        created_by = @createBy, action_code = @actionCode,
        receiver = @receiver, receiver_unit = @receiverUnit,
        roleProcess = @roleProcess, stage_status = @stageStatus,
        updated_at = GETDATE()
      ${whereClause}
    `;

    await this.queryNewDbTx(query, params, transaction);
  }

  // Hàm map một bản ghi thô từ DB cũ sang định dạng của audit_sync, bao gồm việc ánh xạ document_id và user_id
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
        const mappedUser = await this.helper.mapUserName(username, transaction);
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
        const mappedUnit = await this.helper.mapSenderUnitId(unitname, transaction);
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
      roleProcess: actionParsed.roleProcess || null,
      stage_status: actionParsed.stage_status || null,
    };
  }

  // Hàm kiểm tra xem đã tồn tại bản ghi audit_sync nào tương ứng với bản ghi audit cũ chưa, dựa trên id_van_ban và receiver/receiver_unit
  async _getExistingAuditSync(audit, transaction) {
    if (!transaction) {
      throw new Error('_getExistingAuditSync requires transaction');
    }

    if (!audit?.id_van_ban) return null;

    const receiver = this._normalizeArrayField(audit.receiver);
    const receiverUnit = this._normalizeArrayField(audit.receiver_unit);

    if (!receiver && !receiverUnit) return null;

    let query = `
      SELECT TOP 1 id
      FROM ${process.env.NEW_DB_NAME}.${newDbSchema}.${newDbTable}
      WHERE id_van_ban = @idVanBan
    `;

    const params = { idVanBan: audit.id_van_ban };

    if (receiver) {
      query += ` AND receiver = @receiver`;
      params.receiver = receiver;
    }

    if (receiverUnit) {
      query += ` AND receiver_unit = @receiverUnit`;
      params.receiverUnit = receiverUnit;
    }

    const result = await this.queryNewDbTx(query, params, transaction);

    return result?.[0] || null;
  }

  // Hàm lấy document_id mới dựa trên idVanBan từ DB cũ, kiểm tra cả outgoing và incoming documents
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
        FROM ${process.env.NEW_DB_NAME}.${newDbSchema}.outgoing_documents
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
        FROM ${process.env.NEW_DB_NAME}.${newDbSchema}.incomming_documents
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

  // Helper để chuẩn hóa trường array thành string để so sánh trong SQL
  _normalizeArrayField(value) {
    if (!value) return null;
    if (Array.isArray(value)) {
      return value.length ? value.join(',') : null;
    }
    return String(value).trim() || null;
  }

  // Transaction helpers
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
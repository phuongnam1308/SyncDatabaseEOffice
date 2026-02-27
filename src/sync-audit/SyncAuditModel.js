const BaseModel = require("../../models/BaseModel");
const logger = require("../../utils/logger");
const MigrationHelper = require("../helpers/MigrationHelper");

class SyncAuditModel extends BaseModel {
  constructor(oldDbTable) {
    super();
    this.oldDbSchema = "dbo";
    this.oldDbTable = oldDbTable;

    this.newDbSchema = "dbo";
    this.newDbTable = "audit";

    this.helper = new MigrationHelper(this.queryNewDbTx.bind(this));
  }

  async fetchByDocumentId(oldDocumentId) {
    if (!oldDocumentId) return [];

    const query = `
      SELECT *
      FROM ${this.oldDbSchema}.${this.oldDbTable}
      WHERE IDVanBan = @oldDocumentId
      ORDER BY ID ASC
    `;

    return this.queryOldDb(query, {
      oldDocumentId: String(oldDocumentId),
    });
  }

  async processSingleRecord(rawRecord, documentId, externalTransaction = null) {
    if (!rawRecord || !documentId) return null;

    const transaction =
      externalTransaction || (await this.beginTransaction());

    const ownsTransaction = !externalTransaction;

    try {
      const mapped = await this._mapSingleRecord(
        rawRecord,
        documentId,
        transaction
      );

      if (!mapped) {
        if (ownsTransaction) await this.commitTransaction(transaction);
        return null;
      }

      const existed = await this._getExistingAudit(mapped, transaction);

      if (existed) {
        await this._update(mapped, transaction);
      } else {
        await this._insert(mapped, transaction);
      }

      if (ownsTransaction) await this.commitTransaction(transaction);

      return {
        inserted: existed ? 0 : 1,
        updated: existed ? 1 : 0,
      };
    } catch (error) {
      if (ownsTransaction) await this.rollbackTransaction(transaction);

      logger.error(
        `[AuditSyncModel.processSingleRecord] table=${this.oldDbTable} ID=${rawRecord?.ID}`,
        error
      );

      throw error;
    }
  }

  async _getExistingAudit(audit, transaction) {
    if (!audit?.document_id || !audit?.time)
      return null;

    const query = `
      SELECT TOP 1 id
      FROM ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable}
      WHERE document_id = @document_id
        AND [time] = @time
        AND (
          (@user_id IS NULL AND user_id IS NULL)
          OR user_id = @user_id
        )
    `;

    const result = await this.queryNewDbTx(
      query,
      {
        document_id: audit.document_id,
        time: audit.time,
        user_id: audit.user_id ?? null,
      },
      transaction
    );

    return result?.[0] || null;
  }

  async _insert(data, transaction) {
    const receiver = this._normalizeArrayField(data.receiver);
    const receiverUnit = this._normalizeArrayField(data.receiver_unit);

    const query = `
      INSERT INTO ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable} (
        document_id,
        [time],
        user_id,
        display_name,
        action_code,
        receiver,
        receiver_unit,
        roleProcess,
        stage_status,
        created_at,
        updated_at,
        type_document,
        table_backups
      )
      VALUES (
        @document_id,
        @time,
        @user_id,
        @display_name,
        @action_code,
        @receiver,
        @receiver_unit,
        @roleProcess,
        @stage_status,
        @created_at,
        GETDATE(),
        @type_document,
        @table_backups
      )
    `;

    await this.queryNewDbTx(
      query,
      {
        document_id: data.document_id,
        time: data.time,
        user_id: data.user_id ?? null,
        display_name: data.display_name ?? null,
        action_code: data.action_code ?? null,
        receiver,
        receiver_unit: receiverUnit,
        roleProcess: data.roleProcess ?? null,
        stage_status: data.stage_status ?? null,
        created_at: data.time,
        type_document: data.type_document ?? "OutgoingDocument",
        table_backups: this.oldDbTable,
      },
      transaction
    );
  }

  async _update(data, transaction) {
    const receiver = this._normalizeArrayField(data.receiver);
    const receiverUnit = this._normalizeArrayField(data.receiver_unit);

    const query = `
      UPDATE ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable}
      SET
        display_name = @display_name,
        action_code = @action_code,
        receiver = @receiver,
        receiver_unit = @receiver_unit,
        roleProcess = @roleProcess,
        stage_status = @stage_status,
        updated_at = GETDATE()
      WHERE document_id = @document_id
        AND [time] = @time
        AND (
          (@user_id IS NULL AND user_id IS NULL)
          OR user_id = @user_id
        )
    `;

    await this.queryNewDbTx(
      query,
      {
        document_id: data.document_id,
        time: data.time,
        user_id: data.user_id ?? null,
        display_name: data.display_name ?? null,
        action_code: data.action_code ?? null,
        receiver,
        receiver_unit: receiverUnit,
        roleProcess: data.roleProcess ?? null,
        stage_status: data.stage_status ?? null,
      },
      transaction
    );
  }

  async _mapSingleRecord(record, documentId, transaction) {
    if (!record?.ID || !record?.IDVanBan)
      return null;

    const parsedTime =
      this.helper.parseDate(record.NgayTao);

    if (!parsedTime)
      return null;

    const user_id =
      await this.helper.mapUserName(
        record.NguoiXuLy,
        transaction
      );

    const displayName =
      this.helper.extractDisplayName(
        record.NguoiXuLy
      );

    const actionParsed =
      this.helper.parseActionString(
        user_id,
        record.HanhDong
      ) || {};

    return {
      document_id: documentId,
      time: parsedTime,
      action_code: actionParsed.action_code ?? null,
      receiver: actionParsed.receiver ?? [],
      receiver_unit:
        actionParsed.receiver_unit ?? [],
      display_name: displayName ?? null,
      user_id: user_id ?? null,
      roleProcess:
        actionParsed.roleProcess ?? null,
      stage_status:
        actionParsed.stage_status ?? null,
      type_document:
        actionParsed.type_document ??
        "OutgoingDocument",
    };
  }

  _normalizeArrayField(value) {
    if (!value) return null;

    if (Array.isArray(value)) {
      return value.length
        ? value.join(",")
        : null;
    }

    return String(value).trim() || null;
  }
}

module.exports = SyncAuditModel;
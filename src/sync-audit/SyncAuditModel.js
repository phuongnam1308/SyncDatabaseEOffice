const BaseModel = require("../../models/BaseModel");
const logger = require("../../utils/logger");
const MigrationHelper = require("../helpers/MigrationHelper");
const sql = require("mssql");

const CATEGORY_RELEASE_DV = "Phát hành văn bản ĐV";
const CATEGORY_RELEASE_TCT = "Phát hành văn bản TCT";

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
    return this._fetchByDocumentIdInternal(
      oldDocumentId
    );
  }

  async fetchByOutgoingDocumentId(
    oldDocumentId
  ) {
    return this._fetchByDocumentIdInternal(
      oldDocumentId,
      [
        CATEGORY_RELEASE_DV,
        CATEGORY_RELEASE_TCT,
      ]
    );
  }

  async fetchByDocumentIdWithCategories(
    oldDocumentId,
    categories = []
  ) {
    return this._fetchByDocumentIdInternal(
      oldDocumentId,
      categories
    );
  }

  async _fetchByDocumentIdInternal(
    oldDocumentId,
    categories = null
  ) {
    if (!oldDocumentId) return [];

    const normalizedDocumentId =
      String(oldDocumentId).trim();

    const params = {
      oldDocumentId: normalizedDocumentId,
    };

    let categoryFilter = "";
    const normalizedCategories =
      this._normalizeCategories(categories);

    if (normalizedCategories.length) {
      const placeholders = normalizedCategories
        .map((_, idx) => `@category${idx}`)
        .join(", ");

      categoryFilter = `
        AND LTRIM(RTRIM(ISNULL(Category, ''))) IN (${placeholders})
      `;

      normalizedCategories.forEach(
        (category, idx) => {
          params[`category${idx}`] = category;
        }
      );
    }

    const query = `
      SELECT *
      FROM ${this.oldDbSchema}.${this.oldDbTable}
      WHERE (
          LTRIM(RTRIM(ISNULL(IDVanBan, ''))) = @oldDocumentId
          OR LTRIM(RTRIM(ISNULL(VBId, ''))) = @oldDocumentId
          OR LTRIM(RTRIM(ISNULL(IDVanBanGoc, ''))) = @oldDocumentId
          OR LTRIM(RTRIM(ISNULL(VBGocId, ''))) = @oldDocumentId
      )
      ${categoryFilter}
      ORDER BY
        COALESCE(
          TRY_CONVERT(datetime, NgayTao, 120),
          TRY_CONVERT(datetime, NgayTao, 121),
          TRY_CONVERT(datetime, NgayTao, 103),
          TRY_CONVERT(datetime, NgayTao, 105),
          TRY_CONVERT(datetime, NgayTao),
          GETDATE()
        ) ASC,
        ID ASC
    `;

    return this.queryOldDb(query, params);
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

      const existed = await this._getExistingAudit(
        mapped,
        transaction
      );

      if (existed) {
        await this._update(mapped, existed.id, transaction);
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
    if (!audit) return null;

    if (audit.origin_id) {
      const byOriginQuery = `
        SELECT TOP 1 id
        FROM ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable}
        WHERE origin_id = @origin_id
          AND table_backups = @table_backups
      `;

      const byOrigin = await this.queryNewDbTx(
        byOriginQuery,
        {
          origin_id: audit.origin_id,
          table_backups:
            audit.table_backups ||
            this.oldDbTable,
        },
        transaction
      );

      if (byOrigin?.[0]) {
        return byOrigin[0];
      }
    }

    if (!audit.document_id || !audit.time) return null;

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
    const receiver =
      this._normalizeArrayField(data.receiver, 100);
    const receiverUnit = this._normalizeArrayField(
      data.receiver_unit,
      100
    );

    const query = `
      INSERT INTO ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable} (
        document_id,
        [time],
        user_id,
        display_name,
        action_code,
        details,
        origin_id,
        created_by,
        receiver,
        receiver_unit,
        group_,
        roleProcess,
        [action],
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
        @details,
        @origin_id,
        @created_by,
        @receiver,
        @receiver_unit,
        @group_,
        @roleProcess,
        @action,
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
        details: data.details ?? null,
        origin_id: data.origin_id ?? null,
        created_by: data.created_by ?? null,
        receiver,
        receiver_unit: receiverUnit,
        group_: this._normalizeTextField(
          data.group_,
          100
        ),
        roleProcess: data.roleProcess ?? null,
        action: this._normalizeTextField(
          data.action,
          255
        ),
        stage_status: data.stage_status ?? null,
        created_at: data.time ?? new Date(),
        type_document: data.type_document ?? "OutgoingDocument",
        table_backups:
          data.table_backups ||
          this.oldDbTable,
      },
      transaction
    );
  }

  async _update(data, existingId, transaction) {
    if (!existingId) return;

    const receiver =
      this._normalizeArrayField(data.receiver, 100);
    const receiverUnit = this._normalizeArrayField(
      data.receiver_unit,
      100
    );

    const query = `
      UPDATE ${process.env.NEW_DB_NAME}.${this.newDbSchema}.${this.newDbTable}
      SET
        display_name = @display_name,
        action_code = @action_code,
        details = @details,
        created_by = @created_by,
        receiver = @receiver,
        receiver_unit = @receiver_unit,
        group_ = @group_,
        roleProcess = @roleProcess,
        [action] = @action,
        stage_status = @stage_status,
        type_document = @type_document,
        updated_at = GETDATE()
      WHERE id = @id
    `;

    await this.queryNewDbTx(
      query,
      {
        id: existingId,
        display_name: data.display_name ?? null,
        action_code: data.action_code ?? null,
        details: data.details ?? null,
        created_by: data.created_by ?? null,
        receiver,
        receiver_unit: receiverUnit,
        group_: this._normalizeTextField(
          data.group_,
          100
        ),
        roleProcess: data.roleProcess ?? null,
        action: this._normalizeTextField(
          data.action,
          255
        ),
        stage_status: data.stage_status ?? null,
        type_document:
          data.type_document ??
          "OutgoingDocument",
      },
      transaction
    );
  }

  async _mapSingleRecord(record, documentId, transaction) {
    if (!record?.ID || !documentId)
      return null;

    const parsedTime =
      this.helper.parseDate(record.NgayTao);
    const time =
      parsedTime || new Date();

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
    const receiver =
      await this._mapReceiverUsers(
        actionParsed.receiver,
        transaction
      );
    const receiverUnit =
      await this._mapReceiverUnits(
        actionParsed.receiver_unit,
        transaction
      );
    const rawAction =
      this._normalizeTextField(
        record.HanhDong
      );

    return {
      document_id: documentId,
      time,
      action_code: actionParsed.action_code ?? null,
      details: rawAction ?? null,
      origin_id: this._normalizeTextField(
        record.ID,
        100
      ),
      created_by: user_id ?? null,
      receiver,
      receiver_unit: receiverUnit,
      group_: this._normalizeTextField(
        record.Category,
        100
      ),
      display_name: displayName ?? null,
      user_id: user_id ?? null,
      roleProcess:
        actionParsed.roleProcess ?? null,
      action: this._normalizeTextField(
        rawAction,
        255
      ),
      stage_status:
        actionParsed.stage_status ?? null,
      type_document:
        actionParsed.type_document ??
        "OutgoingDocument",
      table_backups: this.oldDbTable,
    };
  }

  async _mapReceiverUsers(receiverValues, transaction) {
    if (!Array.isArray(receiverValues))
      return [];

    const normalized = [
      ...new Set(
        receiverValues
          .map((value) =>
            this._normalizeTextField(value)
          )
          .filter(Boolean)
      ),
    ];

    const mapped = [];

    for (const userName of normalized) {
      const userId =
        await this.helper.mapUserName(
          userName,
          transaction
        );

      if (userId) {
        mapped.push(String(userId));
      }
    }

    return mapped;
  }

  async _mapReceiverUnits(receiverUnitValues, transaction) {
    if (!Array.isArray(receiverUnitValues))
      return [];

    const normalized = [
      ...new Set(
        receiverUnitValues
          .map((value) =>
            this._normalizeTextField(value)
          )
          .filter(Boolean)
      ),
    ];

    const mapped = [];

    for (const unitName of normalized) {
      const unitId =
        await this.helper.mapSenderUnitId(
          unitName,
          transaction
        );

      if (unitId) {
        mapped.push(String(unitId));
      }
    }

    return mapped;
  }

  _normalizeArrayField(value, maxLength = null) {
    if (!value) return null;

    let normalized = null;

    if (Array.isArray(value)) {
      normalized = value.length
        ? value.join(",")
        : null;
    } else {
      normalized =
        String(value).trim() || null;
    }

    if (
      normalized &&
      maxLength &&
      normalized.length > maxLength
    ) {
      return normalized.substring(0, maxLength);
    }

    return normalized;
  }

  _normalizeTextField(value, maxLength = null) {
    if (value === null || value === undefined)
      return null;

    let normalized = String(value).trim();
    if (!normalized) return null;

    if (normalized.toUpperCase() === "NULL") {
      return null;
    }

    if (
      maxLength &&
      normalized.length > maxLength
    ) {
      normalized = normalized.substring(
        0,
        maxLength
      );
    }

    return normalized;
  }

  _normalizeCategories(categories) {
    if (!Array.isArray(categories)) {
      return [];
    }

    return [
      ...new Set(
        categories
          .map((category) =>
            this._normalizeTextField(category)
          )
          .filter(Boolean)
      ),
    ];
  }

  async beginTransaction() {
    const transaction = new sql.Transaction(
      this.newPool
    );
    await transaction.begin();
    return transaction;
  }

  async commitTransaction(transaction) {
    if (!transaction) return;
    await transaction.commit();
  }

  async rollbackTransaction(transaction) {
    if (!transaction) return;

    try {
      await transaction.rollback();
    } catch (error) {
      logger.error(
        "[SyncAuditModel.rollbackTransaction] failed:",
        error
      );
    }
  }
}

module.exports = SyncAuditModel;

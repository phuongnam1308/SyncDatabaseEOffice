const BaseModel = require("../../../models/BaseModel");
const logger = require("../../../utils/logger");
const sql = require('mssql');
const MigrationHelper = require("../../helpers/MigrationHelper");

class StreamOutgoingMigrationModel extends BaseModel {
  constructor() {
    super();
    this.oldDbSchema = "dbo";
    this.oldDbTable = "VanBanBanHanh";
    this.newDbSchema = "dbo";
    this.newDbTable = "outgoing_documents_sync";
    this.helper = new MigrationHelper(this.queryNewDbTx.bind(this));
  }

  async getStatus() {
    try {
      const countOldQuery = `
        SELECT COUNT(*) AS total
        FROM ${this.oldDbSchema}.${this.oldDbTable}
      `;
      const oldResult = await this.queryOldDb(countOldQuery);
      const totalInOldDb = oldResult[0]?.total || 0;

      const countNewQuery = `
        SELECT COUNT(*) AS total
        FROM camunda.${this.newDbSchema}.${this.newDbTable}
        WHERE table_backup = 'stream_migration'
      `;
      const newResult = await this.queryNewDbTx(countNewQuery);
      const totalInNewDb = newResult[0]?.total || 0;

      const lastIdQuery = `
        SELECT TOP 1 id_outgoing_bak
        FROM camunda.${this.newDbSchema}.${this.newDbTable}
        WHERE table_backup = 'stream_migration'
        ORDER BY createdAt DESC
      `;
      const lastIdResult = await this.queryNewDbTx(lastIdQuery);
      const lastMigratedId = lastIdResult[0]?.id_outgoing_bak || null;

      return {
        totalInOldDb,
        totalInNewDb,
        remaining: totalInOldDb - totalInNewDb,
        lastMigratedId,
      };
    } catch (error) {
      logger.error("[StreamOutgoingMigrationModel.getStatus] Error:", error);
      throw error;
    }
  }

  async fetchBatchFromOldDb({ batch, lastId = null }) {
    try {
      let query = `
        SELECT TOP (@batch)
            ID, Title, BanLanhDao, ChenSo, TrangThai, IsLibrary,
            DoKhan, DoMat, DonVi, Files, ChucVu, DocNum,
            NguoiSoanThaoText, FolderLocation, HoSoXuLyLink,
            InfoVBDi, ItemVBPH, LoaiBanHanh, LoaiVanBan,
            NoiLuuTru, NoiNhan, NgayBanHanh, NgayHieuLuc,
            NgayHoanTat, NguoiKyVanBan, NguoiKyVanBanText,
            PhanCong, TraLoiVBDen, SoBan, SoTrang,
            SoVanBan, SoVanBanText, TrichYeu,
            BanLanhDaoTCT, YKien, YKienChiHuy,
            ModuleId, SiteName, ListName, ItemId,
            YearMonth, Modified, Created, ModifiedBy, CreatedBy,
            LoaiMoc, KySoFiles, DGPId, Workflow,
            IsKyQuyChe, DocSignType, IsConverting,
            TrangThai
        FROM ${this.oldDbSchema}.${this.oldDbTable}
        WHERE 1=1
      `;

      const params = { batch };

      if (lastId !== null && lastId !== undefined) {
        query += ` AND CAST(ID AS BIGINT) > @lastId`;
        params.lastId = lastId;
      }

      query += ` ORDER BY CAST(ID AS BIGINT) ASC`;

      const records = await this.queryOldDb(query, params);

      logger.debug(`[fetchBatchFromOldDb] lastId=${lastId} → fetched ${records.length}`);

      return records;
    } catch (error) {
      logger.error("[fetchBatchFromOldDb] Error:", error);
      throw error;
    }
  }

  async mapAndCleanBatch(records) {
    try {
      const mappedRecords = [];

      for (const record of records) {
        try {
          const mapped = await this._mapSingleRecord(record);
          mappedRecords.push(mapped);
        } catch (error) {
          logger.warn(`[mapAndCleanBatch] Skip record ID=${record.ID}:`, error.message);
        }
      }

      logger.debug(`[mapAndCleanBatch] Mapped ${mappedRecords.length}/${records.length} records`);

      return mappedRecords;
    } catch (error) {
      logger.error("[StreamOutgoingMigrationModel.mapAndCleanBatch] Error:", error);
      throw error;
    }
  }

  async _mapSingleRecord(oldRecord) {
    try {
      if (!oldRecord?.ID) {
        throw new Error("Old record ID is required");
      }

      const now = new Date();

      const promulgationDate = this.helper.parseDate(oldRecord.NgayBanHanh);
      const effectiveDate = this.helper.parseDate(oldRecord.NgayHieuLuc);

      const documentType = await this.helper.processDocumentType(
        oldRecord.LoaiVanBan || oldRecord.LoaiBanHanh
      );

      const urgencyLevel = await this.helper.processUrgencyLevel(oldRecord.DoKhan);
      const privateLevel = await this.helper.processPrivateLevel(oldRecord.DoMat);

      const senderUnit = await this.helper.mapSenderUnitId(oldRecord.DonVi);
      const drafter = await this.helper.mapUserName(oldRecord.CreatedBy || oldRecord.NguoiSoanThaoText);
      const reportSigner = await this.helper.mapUserName(oldRecord.NguoiKyVanBanText);

      const year = promulgationDate ? new Date(promulgationDate).getFullYear() : null;

      const bookDocumentObj = await this.helper.mapBookDocument(
        oldRecord.SoVanBan || oldRecord.SoVanBanText,
        { drafter, senderUnit, privateLevel, year }
      );
      const bookDocumentId = bookDocumentObj ? bookDocumentObj.id : null;
      const toBook = bookDocumentObj ? bookDocumentObj.count : null;

      const mapped = {
        document_id: `${Date.now()}${Math.floor(Math.random() * 10000)}`,
        id_outgoing_bak: String(oldRecord.ID),
        code: this.helper.cleanText(oldRecord.SoKyHieu || oldRecord.SoVanBanText),
        abstract_note: this.helper.cleanText(oldRecord.TrichYeu),
        promulgation_date: promulgationDate,
        effective_date: effectiveDate,
        status_code: this.helper.mapStatus(oldRecord.TrangThai),
        document_type: documentType,
        urgency_level: urgencyLevel,
        private_level: privateLevel,
        sender_unit: senderUnit,
        to_book: toBook,
        drafter,
        report_signer: reportSigner,
        release_no: this.helper.cleanText(oldRecord.Title),
        to_book_text_symbols: this.helper.cleanText(oldRecord.Title),
        release_date: promulgationDate || null,
        bpmn_version: oldRecord.Workflow ? "VAN_BAN_DI" : null,
        type_of_process: oldRecord.Workflow ? this.helper.cleanText(oldRecord.Workflow) : null,
        book_document_id: bookDocumentId,
        status: "1",
        replaced: 0,
        tb_bak: 0,
        table_backup: "stream_migration",
        created_at: now,
        updated_at: now,
      };

      return mapped;
    } catch (error) {
      logger.error(`[_mapSingleRecord] Error ID=${oldRecord?.ID}: ${error.message}`);
      throw error;
    }
  }

  async insertBatchToNewDb(records) {
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
            SELECT id FROM camunda.${this.newDbSchema}.${this.newDbTable}
            WHERE id_outgoing_bak = @oldId AND table_backup = 'stream_migration'
          `;
          const existing = await this.queryNewDbTx(existingQuery, { oldId: record.id_outgoing_bak }, transaction);

          if (existing && existing.length > 0) {
            await this._updateRecord(record, transaction);
            updated++;
          } else {
            await this._insertRecord(record, transaction);
            inserted++;
          }
        } catch (recordError) {
          logger.warn(`[insertBatchToNewDb] Skip record id_outgoing_bak=${record.id_outgoing_bak}:`, recordError.message);
        }
      }

      await this.commitTransaction(transaction);

      logger.debug(`[insertBatchToNewDb] Inserted: ${inserted}, Updated: ${updated}`);

      return { inserted, updated };
    } catch (error) {
      if (transaction) {
        await this.rollbackTransaction(transaction);
        logger.error("[insertBatchToNewDb] Transaction rolled back");
      }

      logger.error("[StreamOutgoingMigrationModel.insertBatchToNewDb] Error:", error);
      throw error;
    }
  }

  async _insertRecord(record, transaction) {
    if (!record?.document_id || record.document_id.trim() === "") {
      throw new Error("document_id is required");
    }
    console.log(`Inserting record id_outgoing_bak=${record.id_outgoing_bak}...`);

    const now = new Date();

    const query = `
      INSERT INTO ${this.newDbSchema}.${this.newDbTable} (
        document_id, status_code, sender_unit, abstract_note, drafter, document_type,
        urgency_level, private_level, report_signer, report_document_symbol, deadline_reply,
        book_document_id, status, release_no, to_book_text_symbols, to_book, release_date, text_symbols, type_doc,
        bpmn_version, type_of_process, id_outgoing_bak, created_at, updated_at,
        replaced, table_backup, tb_bak
      )
      VALUES (
        @documentId, @statusCode, @senderUnit, @abstractNote, @drafter, @documentType,
        @urgencyLevel, @privateLevel, @reportSigner, @reportDocumentSymbol, @deadlineReply,
        @bookDocumentId, @status, @releaseNo, @releaseDate, @textSymbols, @typeDoc,
        @bpmnVersion, @typeOfProcess, @idOutgoingBak, @createdAt, @updatedAt,
        @replaced, @tableBackup, @tbBak
      )
    `;

    const params = {
      documentId: record.document_id,
      statusCode: record.status_code ?? "1",
      senderUnit: record.sender_unit ?? null,
      drafter: record.drafter ?? null,
      documentType: record.document_type ?? null,
      urgencyLevel: record.urgency_level ?? null,
      privateLevel: record.private_level ?? null,
      reportSigner: record.report_signer ?? null,
      reportDocumentSymbol: record.report_document_symbol ?? null,
      deadlineReply: record.deadline_reply ?? null,
      bookDocumentId: record.book_document_id ?? null,
      status: record.status ?? 1,
      releaseNo: record.release_no ?? null,
      toBookTextSymbols: record.to_book_text_symbols ?? null,
      toBook: record.to_book ?? null,
      releaseDate: record.release_date ?? null,
      textSymbols: record.text_symbols ?? null,
      typeDoc: record.type_doc ?? 1,
      bpmnVersion: record.bpmn_version ?? null,
      typeOfProcess: record.type_of_process ?? null,
      idOutgoingBak: record.id_outgoing_bak ?? null,
      createdAt: record.created_at ?? now,
      abstractNote: record.abstract_note ?? null,
      updatedAt: now,
      replaced: record.replaced ?? 0,
      tableBackup: record.table_backup ?? "stream_migration",
      tbBak: record.tb_bak ?? 0,
    };

    await this.queryNewDbTx(query, params, transaction);
  }

  async _updateRecord(record, transaction) {
    if (!record?.id_outgoing_bak) {
      throw new Error("document_id is required for update");
    }
    console.log(`Updating record id_outgoing_bak=${record.id_outgoing_bak}...`);

    const query = `
      UPDATE ${this.newDbSchema}.${this.newDbTable}
      SET
        status_code = @statusCode, sender_unit = @senderUnit, drafter = @drafter,
        document_type = @documentType, urgency_level = @urgencyLevel, private_level = @privateLevel,
        report_signer = @reportSigner, report_document_symbol = @reportDocumentSymbol,
        deadline_reply = @deadlineReply, book_document_id = @bookDocumentId, status = @status,
        release_no = @releaseNo, to_book_text_symbols = @toBookTextSymbols, release_date = @releaseDate, text_symbols = @textSymbols,
        type_doc = @typeDoc, bpmn_version = @bpmnVersion, type_of_process = @typeOfProcess,
        replaced = @replaced, abstract_note = @abstractNote, updated_at = GETDATE()
      WHERE id_outgoing_bak = @idOutgoingBak AND table_backup = 'stream_migration'
    `;

    const params = {
      statusCode: record.status_code ?? "1",
      senderUnit: record.sender_unit ?? null,
      drafter: record.drafter ?? null,
      documentType: record.document_type ?? null,
      urgencyLevel: record.urgency_level ?? null,
      privateLevel: record.private_level ?? null,
      reportSigner: record.report_signer ?? null,
      reportDocumentSymbol: record.report_document_symbol ?? null,
      deadlineReply: record.deadline_reply ?? null,
      bookDocumentId: record.book_document_id ?? null,
      status: record.status ?? 1,
      releaseNo: record.release_no ?? null,
      toBookTextSymbols: record.to_book_text_symbols ?? null,
      releaseDate: record.release_date ?? null,
      textSymbols: record.text_symbols ?? null,
      typeDoc: record.type_doc ?? 1,
      bpmnVersion: record.bpmn_version ?? null,
      typeOfProcess: record.type_of_process ?? null,
      idOutgoingBak: record.id_outgoing_bak ?? null,
      abstractNote: record.abstract_note ?? null,
      replaced: record.replaced ?? 0,
    };

    await this.queryNewDbTx(query, params, transaction);
  }

  async rollback(options = {}) {
    try {
      const query = `
        DELETE FROM camunda.${this.newDbSchema}.${this.newDbTable}
        WHERE table_backup = 'stream_migration'
      `;

      const result = await this.queryNewDbTx(query);
      const deleted = result.rowsAffected || 0;

      logger.info(`[StreamOutgoingMigrationModel.rollback] Deleted ${deleted} records`);

      return { deleted };
    } catch (error) {
      logger.error("[StreamOutgoingMigrationModel.rollback] Error:", error);
      throw error;
    }
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

module.exports = StreamOutgoingMigrationModel;
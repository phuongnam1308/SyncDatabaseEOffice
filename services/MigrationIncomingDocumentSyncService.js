// services/MigrationIncomingDocumentSyncService.js
const IncomingDocumentModel = require('../models/IncomingDocumentModel');
const { chunkArray, formatNumber } = require('../utils/helpers');
const logger = require('../utils/logger');

class MigrationIncomingDocumentSyncService {
  constructor() {
    this.model = new IncomingDocumentModel();
    this.batchSize = parseInt(process.env.BATCH_SIZE || '200');
  }

  async initialize() {
    await this.model.initialize();
    logger.info('MigrationIncomingDocumentSyncService đã khởi tạo');
  }

  async syncIncomingDocuments() {
    const startTime = Date.now();
    logger.info('=== BẮT ĐẦU ĐỒNG BỘ incomming_documents2 → incomming_documents ===');

    try {
      // 1. Lấy tất cả record từ bảng tạm (incomming_documents2) chưa được sync
      const totalToSync = await this.model.countUnsyncedFromTempTable();
      logger.info(`Tổng số văn bản cần đồng bộ: ${formatNumber(totalToSync)}`);

      if (totalToSync === 0) {
        return { success: true, synced: 0, skipped: 0, errors: 0, message: 'Không có dữ liệu cần đồng bộ' };
      }

      const records = await this.model.getUnsyncedFromTempTable();
      const batches = chunkArray(records, this.batchSize);

      let syncedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (let i = 0; i < batches.length; i++) {
        logger.info(`Xử lý batch ${i + 1}/${batches.length}...`);

        for (const record of batches[i]) {
          try {
            // Kiểm tra đã tồn tại trong bảng chính chưa (dựa vào document_id hoặc id_incoming_bak)
            const exists = await this.model.checkExistsInMainTable(record.id_incoming_bak, record.document_id);
            if (exists) {
              skippedCount++;
              logger.warn(`SKIP: document_id ${record.document_id || record.id_incoming_bak} đã tồn tại trong bảng chính`);
              continue;
            }

            // Chuẩn bị dữ liệu cho bảng chính (mapping + clean)
            const mainRecord = this.prepareMainRecord(record);

            // Insert vào bảng chính
            await this.model.insertToMainTable(mainRecord);

            // Backup vào table_backups (nếu cần)
            await this.model.backupToTableBackups(record);

            // Đánh dấu đã xử lý (tb_update = 1)
            await this.model.markAsSynced(record.document_id || record.id_incoming_bak);

            syncedCount++;
            logger.info(`Synced: ${record.id_incoming_bak || record.document_id}`);

          } catch (err) {
            errorCount++;
            logger.error(`Lỗi đồng bộ record ${record.id_incoming_bak || 'unknown'}: ${err.message}`);
          }
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      return {
        success: true,
        total: totalToSync,
        synced: syncedCount,
        skipped: skippedCount,
        errors: errorCount,
        duration: `${duration}s`
      };

    } catch (error) {
      logger.error('Lỗi toàn bộ quá trình đồng bộ:', error);
      throw error;
    }
  }

  prepareMainRecord(tempRecord) {
    // Mapping các trường từ incomming_documents2 sang incomming_documents
    // Chú ý: một số trường có kiểu dữ liệu khác nhau → cần convert
    const mainRecord = { ...tempRecord };

    // Ví dụ convert / clean một số trường đặc biệt
    if (mainRecord.IsLibrary === '1' || mainRecord.IsLibrary === 1) {
      mainRecord.IsLibrary = true;
    } else {
      mainRecord.IsLibrary = false;
    }

    if (mainRecord.ChenSo === '1' || mainRecord.ChenSo === 1) {
      mainRecord.ChenSo = true;
    } else {
      mainRecord.ChenSo = false;
    }

    // ForwardType: string → tinyint
    if (mainRecord.ForwardType) {
      mainRecord.ForwardType = parseInt(mainRecord.ForwardType, 10) || 0;
    }

    // receive_method, private_level, urgency_level... giới hạn độ dài
    ['receive_method', 'private_level', 'urgency_level'].forEach(field => {
      if (mainRecord[field] && mainRecord[field].length > 64) {
        mainRecord[field] = mainRecord[field].substring(0, 64);
      }
    });

    // Đảm bảo document_id không null
    if (!mainRecord.document_id) {
      mainRecord.document_id = `IN_${mainRecord.id_incoming_bak || Date.now()}`;
    }

    return mainRecord;
  }

  async getSyncStatistics() {
    const [tempCount, mainCount, syncedCount, unsyncedCount] = await Promise.all([
      this.model.countTempTable(),
      this.model.countMainTable(),
      this.model.countSynced(),
      this.model.countUnsyncedFromTempTable()
    ]);

    return {
      temp_table: { table: 'incomming_documents2', count: tempCount },
      main_table: { table: 'incomming_documents', count: mainCount },
      synced: syncedCount,
      remaining: unsyncedCount,
      percentage: tempCount > 0 ? ((syncedCount / tempCount) * 100).toFixed(2) : 0
    };
  }

  async close() {
    await this.model.close();
  }
}

module.exports = MigrationIncomingDocumentSyncService;
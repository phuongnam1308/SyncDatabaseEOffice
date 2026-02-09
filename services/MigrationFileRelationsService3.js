// services/MigrationFileRelationsService.js
const FileRelationsModel = require('../models/FileRelationsModel3');
const { tableMappings } = require('../config/tablesFileRelations2');
const { mapFieldValues, chunkArray, formatNumber, calculatePercentage } = require('../utils/helpers');
const logger = require('../utils/logger');

class MigrationFileRelationsService {
  constructor() {
    this.model = new FileRelationsModel();
    this.batchSize = parseInt(process.env.BATCH_SIZE || '200');     // Batch insert
    this.pageSize = parseInt(process.env.PAGE_SIZE || '1000');      // Pagination fetch
  }

  async initialize() {
    try {
      await this.model.initialize();
      logger.info('MigrationFileRelationsService đã được khởi tạo');
    } catch (error) {
      logger.error('Lỗi khởi tạo MigrationFileRelationsService:', error);
      throw error;
    }
  }

  async migrateFileRelations() {
    const startTime = Date.now();
    logger.info('=== BẮT ĐẦU MIGRATION FILE_RELATIONS2 (Pagination) ===');

    try {
      const totalRecords = await this.model.countOldDb();
      logger.info(`Tổng records cần migrate: ${formatNumber(totalRecords)}`);

      if (totalRecords === 0) {
        return { success: true, total: 0, inserted: 0, skipped: 0, errors: 0 };
      }

      let offset = 0;
      let totalInserted = 0;
      let totalSkipped = 0;
      let totalErrors = 0;

      while (offset < totalRecords) {
        const records = await this.model.getPaginatedFromOldDb(offset, this.pageSize);
        
        if (records.length === 0) break;

        logger.info(`→ Đang xử lý trang: offset ${offset} | ${records.length} records`);

        const batches = chunkArray(records, this.batchSize);

        for (let i = 0; i < batches.length; i++) {
          const batch = batches[i];

          for (const oldRecord of batch) {
            // Sửa: Không skip nếu thiếu id, set default '' cho id nếu null (để ghi hết)
            if (!oldRecord) {
              totalErrors++;
              logger.error(`SKIP record lỗi: oldRecord undefined`);
              continue;
            }
            if (oldRecord.id == null) {
              oldRecord.id = '';  // Set default rỗng để insert
              logger.warn(`Record thiếu ID nguồn → set default ''`);
            }

            // Check required fields: Nếu nguoikyvanban null, set default '' cho object_id_bak
            if (oldRecord.nguoikyvanban == null) {
              oldRecord.nguoikyvanban = '';  // Hoặc 'UNKNOWN' tùy schema
              logger.warn(`Record ID: ${oldRecord.id} | nguoikyvanban null → set default ''`);
            }

            try {
              // Log chi tiết để debug (có thể remove sau)
              logger.debug(`Record ID: ${oldRecord.id} | type_doc: ${oldRecord.type_doc ?? 'undefined'} | nguoikyvanban: ${oldRecord.nguoikyvanban ?? 'null'}`);

              const existing = await this.model.findByBackupId(oldRecord.id);
              if (existing) {
                totalSkipped++;
                continue;
              }

              const newRecord = mapFieldValues(
                oldRecord, 
                tableMappings.fileRelations.fieldMapping,
                tableMappings.fileRelations.defaultValues
              );

              // Thêm check trước insert: Đảm bảo không null cho các cột required
              if (newRecord.object_id_bak == null) {
                newRecord.object_id_bak = '';  // Default non-null
              }
              if (newRecord.object_id == null) {
                newRecord.object_id = '';  // Default non-null
              }

              // Sửa: Không skip file_id, đã set default '' ở defaultValues và check id nguồn
              if (newRecord.file_id === '') {
                logger.warn(`Record ID nguồn: ${oldRecord.id || 'UNKNOWN'} | file_id rỗng → đã set default ''`);
              }

              await this.model.insertToNewDb(newRecord);
              totalInserted++;

            } catch (err) {
              totalErrors++;
              logger.error(`Lỗi record id=${oldRecord.id}: ${err.message}`);
            }
          }
        }

        offset += this.pageSize;
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info('=== HOÀN THÀNH MIGRATION FILE_RELATIONS2 ===');
      logger.info(`Thời gian: ${duration}s | Inserted: ${totalInserted} | Skipped: ${totalSkipped} | Errors: ${totalErrors}`);

      return {
        success: true,
        total: totalRecords,
        inserted: totalInserted,
        skipped: totalSkipped,
        errors: totalErrors,
        duration
      };

    } catch (error) {
      logger.error('Lỗi migration file_relations2:', error);
      throw error;
    }
  }

  async getStatistics() {
    const oldCount = await this.model.countOldDb();
    const newCount = await this.model.countNewDb();

    return {
      source: { table: 'files2', count: oldCount },
      destination: { table: 'file_relations2', count: newCount },
      migrated: newCount,
      remaining: oldCount - newCount,
      percentage: calculatePercentage(newCount, oldCount)
    };
  }

  async close() {
    await this.model.close();
  }
}

module.exports = MigrationFileRelationsService;
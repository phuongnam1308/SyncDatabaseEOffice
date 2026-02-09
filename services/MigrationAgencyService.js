// services/MigrationAgencyService.js
const AgencyModel = require('../models/AgencyModel');
const { tableMappings } = require('../config/tablesAgencies');
const { mapFieldValues, chunkArray, formatNumber, calculatePercentage } = require('../utils/helpers');
const logger = require('../utils/logger');

class MigrationAgencyService {
  constructor() {
    this.agencyModel = new AgencyModel();
    this.batchSize = parseInt(process.env.BATCH_SIZE || '100');
  }

  async initialize() {
    try {
      await this.agencyModel.initialize();
      logger.info('MigrationAgencyService đã được khởi tạo');
    } catch (error) {
      logger.error('Lỗi khởi tạo MigrationAgencyService:', error);
      throw error;
    }
  }

  async migrateAgencies() {
    const startTime = Date.now();
    logger.info('=== BẮT ĐẦU MIGRATION AGENCIES (DEPARTMENT) ===');

    try {
      const config = tableMappings.agency;
      const totalRecords = await this.agencyModel.countOldDb();
      logger.info(`Tổng số đơn vị cần migrate: ${formatNumber(totalRecords)}`);

      if (totalRecords === 0) {
        logger.warn('Không có dữ liệu đơn vị để migrate');
        return { success: true, total: 0, inserted: 0, skipped: 0, errors: 0 };
      }

      const oldRecords = await this.agencyModel.getAllFromOldDb();
      const batches = chunkArray(oldRecords, this.batchSize);

      let totalInserted = 0;
      let totalSkipped = 0;
      let totalErrors = 0;

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        logger.info(`Đang xử lý batch ${i + 1}/${batches.length}...`);

        for (const oldRecord of batch) {
          try {
            const existingByBackup = await this.agencyModel.findByBackupId(oldRecord.ID);
            if (existingByBackup) {
              totalSkipped++;
              logger.warn(`SKIP: ID cũ ${oldRecord.ID} đã tồn tại`);
              continue;
            }

            const newRecord = mapFieldValues(oldRecord, config.fieldMapping, config.defaultValues);

            await this.agencyModel.insertToNewDb(newRecord);
            totalInserted++;

          } catch (error) {
            totalErrors++;
            logger.error(`Lỗi migrate đơn vị ID ${oldRecord.ID}: ${error.message}`);
          }
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info('=== HOÀN THÀNH MIGRATION AGENCIES ===');
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
      logger.error('Lỗi trong quá trình migration Agencies:', error);
      throw error;
    }
  }

  async getStatistics() {
    try {
      const oldCount = await this.agencyModel.countOldDb();
      const newCount = await this.agencyModel.countNewDb();

      return {
        source: { database: 'DataEOfficeSNP', schema: 'dbo', table: 'Department', count: oldCount },
        destination: { database: 'camunda', table: 'agencies', count: newCount },
        migrated: newCount,
        remaining: oldCount - newCount,
        percentage: calculatePercentage(newCount, oldCount)
      };
    } catch (error) {
      logger.error('Lỗi lấy thống kê Agencies:', error);
      throw error;
    }
  }

  async close() {
    await this.agencyModel.close();
  }
}

module.exports = MigrationAgencyService;
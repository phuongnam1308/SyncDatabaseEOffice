// services/MigrationTaskUsersMappingService.js
const TaskUsersMappingModel = require('../models/TaskUsersMappingModel');
const { tableMappings } = require('../config/tablesTaskUsersMapping');
const { chunkArray, formatNumber } = require('../utils/helpers');
const logger = require('../utils/logger');

class MigrationTaskUsersMappingService {
  constructor() {
    this.model = new TaskUsersMappingModel();
    this.batchSize = parseInt(process.env.BATCH_SIZE || '500');
  }

  async initialize() {
    await this.model.initialize();
    logger.info('MigrationTaskUsersMappingService đã khởi tạo');
  }

  async updateTaskIdMapping() {
    const startTime = Date.now();
    logger.info('=== BẮT ĐẦU UPDATE task_id trong task_users2 từ task2 ===');

    try {
      const config = tableMappings.task_users_mapping;
      const mappingData = await this.model.getMappingData();

      logger.info(`Tìm thấy ${formatNumber(mappingData.length)} bản ghi mapping từ task2`);

      if (mappingData.length === 0) {
        return { success: true, mapped: 0, updated: 0, errors: 0 };
      }

      const batches = chunkArray(mappingData, this.batchSize);

      let totalUpdated = 0;
      let totalErrors = 0;

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        logger.info(`Xử lý batch mapping ${i + 1}/${batches.length} (${batch.length} items)`);

        try {
          const updatedCount = await this.model.updateTaskIdInBatch(batch);
          totalUpdated += updatedCount;
        } catch (err) {
          totalErrors++;
          logger.error(`Lỗi batch ${i + 1}: ${err.message}`);
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info(`Hoàn thành update task_id | Updated: ${totalUpdated} | Errors: ${totalErrors} | Thời gian: ${duration}s`);

      return {
        success: true,
        mappedRecords: mappingData.length,
        updatedRows: totalUpdated,
        errors: totalErrors,
        duration
      };

    } catch (error) {
      logger.error('Lỗi trong quá trình mapping task_id:', error);
      throw error;
    }
  }

  async getStatistics() {
    return await this.model.getStatistics();
  }

  async close() {
    await this.model.close();
  }
}

module.exports = MigrationTaskUsersMappingService;
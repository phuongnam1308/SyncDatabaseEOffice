// services/UpdateFiles2NameService.js
const Files2Model = require('../models/Files2Model');
const { chunkArray, formatNumber, calculatePercentage } = require('../utils/helpers');
const logger = require('../utils/logger');
const path = require('path');

class UpdateFiles2NameService {
  constructor() {
    this.model = new Files2Model();
    this.batchSize = parseInt(process.env.BATCH_SIZE || '100');
  }

  async initialize() {
    try {
      await this.model.initialize();
      logger.info('UpdateFiles2NameService đã được khởi tạo');
    } catch (error) {
      logger.error('Lỗi khởi tạo UpdateFiles2NameService:', error);
      throw error;
    }
  }

  async updateFileNames() {
    const startTime = Date.now();
    logger.info('=== BẮT ĐẦU CẬP NHẬT FILE_NAME TỪ FILE_PATH TRONG FILES2 ===');

    try {
      const totalRecords = await this.model.countRecords();
      logger.info(`Tổng số bản ghi trong files2: ${formatNumber(totalRecords)}`);

      if (totalRecords === 0) {
        logger.warn('Không có dữ liệu để cập nhật');
        return { count: 0, skipped: 0, errors: 0 };
      }

      const records = await this.model.getAllRecords();
      const batches = chunkArray(records, this.batchSize);

      let totalUpdated = 0;
      let totalSkipped = 0;
      let totalErrors = 0;

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        logger.info(`Đang xử lý batch ${i + 1}/${batches.length}...`);

        for (const record of batch) {
          try {
            if (!record.file_path) {
              totalSkipped++;
              logger.warn(`SKIP: Bản ghi ID ${record.id} không có file_path`);
              continue;
            }

            // Logic tách file_name từ file_path
            const basename = path.basename(record.file_path); // Lấy phần cuối cùng sau '/'
            // Regex để detect UUID: -[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}
            const uuidRegex = /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
            let newFileName = basename;

            // Nếu match định dạng "name-UUID.ext", loại bỏ UUID
            if (uuidRegex.test(basename)) {
              newFileName = basename.replace(uuidRegex, '') + path.extname(basename);
            }

            // Nếu file_name đã giống, skip
            if (record.file_name === newFileName) {
              totalSkipped++;
              logger.info(`SKIP: Bản ghi ID ${record.id} đã có file_name đúng`);
              continue;
            }

            await this.model.updateFileName(record.id, newFileName);
            totalUpdated++;

          } catch (error) {
            totalErrors++;
            logger.error(`Lỗi cập nhật bản ghi ID ${record.id}:`, error.message);
          }
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info('=== HOÀN THÀNH CẬP NHẬT FILE_NAME ===');
      logger.info(`Thời gian: ${duration}s | Updated: ${totalUpdated} | Skipped: ${totalSkipped} | Errors: ${totalErrors}`);

      return {
        count: totalUpdated,
        skipped: totalSkipped,
        errors: totalErrors,
        duration
      };

    } catch (error) {
      logger.error('Lỗi trong quá trình cập nhật file_name:', error);
      throw error;
    }
  }

  async getStatistics() {
    try {
      const totalCount = await this.model.countRecords();
      const needUpdateCount = await this.model.countNeedUpdate();

      const stats = {
        totalCount,
        needUpdateCount,
        updatedCount: totalCount - needUpdateCount,
        remaining: needUpdateCount,
        percentage: calculatePercentage(totalCount - needUpdateCount, totalCount)
      };
      logger.info('Thống kê: ' + JSON.stringify(stats));
      return stats;
    } catch (error) {
      logger.error('Lỗi lấy thống kê cập nhật file_name:', error);
      throw error;
    }
  }

  async close() {
    await this.model.close();
  }
}

module.exports = UpdateFiles2NameService;
// services/MigrationUserInGroupService.js
const UserInGroupModel = require('../models/UserInGroupModel');
const { tableMappings } = require('../config/tablesUserInGroup');
const { chunkArray, formatNumber } = require('../utils/helpers');
const logger = require('../utils/logger');

class MigrationUserInGroupService {
  constructor() {
    this.userInGroupModel = new UserInGroupModel();
    this.batchSize = parseInt(process.env.BATCH_SIZE || '200'); // Bảng trung gian thường lớn, batch lớn hơn
  }

  async initialize() {
    try {
      await this.userInGroupModel.initialize();
      logger.info('MigrationUserInGroupService đã được khởi tạo');
    } catch (error) {
      logger.error('Lỗi khởi tạo MigrationUserInGroupService:', error);
      throw error;
    }
  }

  async migrateUserInGroup() {
    const startTime = Date.now();
    logger.info('=== BẮT ĐẦU MIGRATION USER IN GROUP ===');

    try {
      const config = tableMappings.useringroup;
      const totalRecords = await this.userInGroupModel.countOldDb();
      logger.info(`Tổng số bản ghi UserInGroup cần migrate: ${formatNumber(totalRecords)}`);

      if (totalRecords === 0) {
        logger.warn('Không có dữ liệu để migrate');
        return { success: true, total: 0, inserted: 0, skipped: 0, errors: 0 };
      }

      const oldRecords = await this.userInGroupModel.getAllFromOldDb();
      const batches = chunkArray(oldRecords, this.batchSize);

      let totalInserted = 0;
      let totalSkipped = 0;
      let totalErrors = 0;

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        logger.info(`Đang xử lý batch ${i + 1}/${batches.length}...`);

        for (const oldRecord of batch) {
          try {
            // Kiểm tra trùng lặp qua cặp id_user_bak + id_group_bak
            const existing = await this.userInGroupModel.findByBackupIds(oldRecord.UserId, oldRecord.GroupId);
            if (existing) {
              totalSkipped++;
              logger.warn(`SKIP: Đã tồn tại cặp UserId ${oldRecord.UserId} - GroupId ${oldRecord.GroupId}`);
              continue;
            }

            // Map dữ liệu
            const newRecord = {
              id_user: null,           // Để null, có thể update sau nếu cần FK thật
              id_group: null,          // Để null, có thể update sau
              id_user_bak: oldRecord.UserId,
              id_group_bak: oldRecord.GroupId,
              id_user_del_bak: null,   // Không dùng ở nguồn này
              table_bak: config.defaultValues.table_bak
            };

            await this.userInGroupModel.insertToNewDb(newRecord);
            totalInserted++;

          } catch (error) {
            totalErrors++;
            logger.error(`Lỗi migrate record UserId ${oldRecord.UserId} - GroupId ${oldRecord.GroupId}: ${error.message}`);
          }
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info('=== HOÀN THÀNH MIGRATION USER IN GROUP ===');
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
      logger.error('Lỗi trong quá trình migration UserInGroup:', error);
      throw error;
    }
  }

  async getStatistics() {
    try {
      const oldCount = await this.userInGroupModel.countOldDb();
      const newCount = await this.userInGroupModel.countNewDb();

      return {
        source: { database: 'DataEOfficeSNP', schema: 'dbo', table: 'UserInGroup', count: oldCount },
        destination: { database: 'DiOffice', table: 'user_group_users_bak', count: newCount },
        migrated: newCount,
        remaining: oldCount - newCount,
        percentage: (newCount / oldCount * 100).toFixed(2) + '%'
      };
    } catch (error) {
      logger.error('Lỗi lấy thống kê UserInGroup:', error);
      throw error;
    }
  }

  async close() {
    await this.userInGroupModel.close();
  }
}

module.exports = MigrationUserInGroupService;
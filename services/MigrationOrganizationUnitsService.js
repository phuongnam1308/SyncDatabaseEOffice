const PhongBanModel = require('../models/PhongBanModel');
const PositionModel = require('../models/PositionModel');
const { tableMappings } = require('../config/tablesOrganizationUnits');
const { mapFieldValues, chunkArray, formatNumber, calculatePercentage } = require('../utils/helpers');
const logger = require('../utils/logger');

class MigrationService {
  constructor() {
    this.phongBanModel = new PhongBanModel();
    this.positionModel = new PositionModel();
    this.batchSize = parseInt(process.env.BATCH_SIZE || '100');
  }

  // Khởi tạo service
  async initialize() {
    try {
      await this.phongBanModel.initialize();
      await this.positionModel.initialize();
      logger.info('Migration Service đã được khởi tạo');
    } catch (error) {
      logger.error('Lỗi khởi tạo Migration Service:', error);
      throw error;
    }
  }

  // Tạo GUID mới (UUID v4)
  generateGuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // Migration phòng ban
  async migratePhongBan() {
    const startTime = Date.now();
    logger.info('=== BẮT ĐẦU MIGRATION PHÒNG BAN ===');

    try {
      // Lấy cấu hình mapping
      const config = tableMappings.phongban;
      
      // Đếm số bản ghi nguồn
      const totalRecords = await this.phongBanModel.countOldDb();
      logger.info(`Tổng số bản ghi cần migrate: ${formatNumber(totalRecords)}`);

      if (totalRecords === 0) {
        logger.warn('Không có dữ liệu để migrate');
        return {
          success: true,
          total: 0,
          inserted: 0,
          savedToBackup: 0,
          skipped: 0,
          errors: 0
        };
      }

      // Lấy tất cả dữ liệu từ DB cũ
      logger.info('Đang lấy dữ liệu từ database cũ...');
      const oldRecords = await this.phongBanModel.getAllFromOldDb();
      logger.info(`Đã lấy ${formatNumber(oldRecords.length)} bản ghi`);

      // Chia thành các batch
      const batches = chunkArray(oldRecords, this.batchSize);
      logger.info(`Chia thành ${batches.length} batch (${this.batchSize} records/batch)`);

      let totalInserted = 0;
      let totalSavedToBackup = 0;
      let totalSkipped = 0;
      let totalErrors = 0;

      // Xử lý từng batch
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchNum = i + 1;
        
        logger.info(`Đang xử lý batch ${batchNum}/${batches.length}...`);

        for (const oldRecord of batch) {
          try {
            // === KIỂM TRA TRÙNG ID CŨ ===
            const existingRecord = await this.phongBanModel.findByBackupId(oldRecord.ID);
            
            if (existingRecord) {
              totalSkipped++;
              logger.warn(`SKIP: ID cũ ${oldRecord.ID} đã tồn tại trong Id_backups (new ID: ${existingRecord.id})`);
              continue; // Bỏ qua, không insert
            }

            // Map dữ liệu từ cũ sang mới
            const newRecord = mapFieldValues(
              oldRecord,
              config.fieldMapping,
              config.defaultValues
            );

            // Tạo GUID mới cho id
            newRecord.id = this.generateGuid().toUpperCase();
            
            // Lưu GUID cũ vào Id_backups
            newRecord.Id_backups = oldRecord.ID;
            
            totalSavedToBackup++;

            logger.info(`Migrating: ${oldRecord.ID} → ${newRecord.id} (backup: ${newRecord.Id_backups})`);

            // Insert vào DB mới
            await this.phongBanModel.insertToNewDb(newRecord);
            totalInserted++;

          } catch (error) {
            totalErrors++;
            logger.error(`Lỗi migrate record ID ${oldRecord.ID}: ${error.message}`);
          }
        }

        // Log progress
        const processedRecords = (i + 1) * this.batchSize;
        const progress = calculatePercentage(
          Math.min(processedRecords, totalRecords),
          totalRecords
        );
        logger.info(`Progress: ${progress}% (${formatNumber(totalInserted)} inserted, ${totalSkipped} skipped, ${totalErrors} errors)`);
      }

      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);

      logger.info('=== HOÀN THÀNH MIGRATION ===');
      logger.info(`Tổng thời gian: ${duration}s`);
      logger.info(`Tổng số bản ghi: ${formatNumber(totalRecords)}`);
      logger.info(`Đã insert: ${formatNumber(totalInserted)}`);
      logger.info(`GUID cũ lưu vào Id_backups: ${formatNumber(totalSavedToBackup)}`);
      logger.info(`Bỏ qua (đã tồn tại): ${formatNumber(totalSkipped)}`);
      logger.info(`Lỗi: ${formatNumber(totalErrors)}`);

      return {
        success: true,
        total: totalRecords,
        inserted: totalInserted,
        savedToBackup: totalSavedToBackup,
        skipped: totalSkipped,
        errors: totalErrors,
        duration: duration
      };

    } catch (error) {
      logger.error('Lỗi trong quá trình migration:', error);
      throw error;
    }
  }

  // Migration position
  async migratePosition() {
    const startTime = Date.now();
    logger.info('=== BẮT ĐẦU MIGRATION POSITION ===');

    try {
      // Lấy cấu hình mapping
      const config = tableMappings.position;
      
      // Đếm số bản ghi nguồn
      const totalRecords = await this.positionModel.countOldDb();
      logger.info(`Tổng số bản ghi cần migrate: ${formatNumber(totalRecords)}`);

      if (totalRecords === 0) {
        logger.warn('Không có dữ liệu để migrate');
        return {
          success: true,
          total: 0,
          inserted: 0,
          savedToBackup: 0,
          skipped: 0,
          errors: 0
        };
      }

      // Lấy tất cả dữ liệu từ DB cũ
      logger.info('Đang lấy dữ liệu từ database cũ...');
      const oldRecords = await this.positionModel.getAllFromOldDb();
      logger.info(`Đã lấy ${formatNumber(oldRecords.length)} bản ghi`);

      // Chia thành các batch
      const batches = chunkArray(oldRecords, this.batchSize);
      logger.info(`Chia thành ${batches.length} batch (${this.batchSize} records/batch)`);

      let totalInserted = 0;
      let totalSavedToBackup = 0;
      let totalSkipped = 0;
      let totalErrors = 0;

      // Xử lý từng batch
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchNum = i + 1;
        
        logger.info(`Đang xử lý batch ${batchNum}/${batches.length}...`);

        for (const oldRecord of batch) {
          try {
            // === KIỂM TRA TRÙNG ID CŨ ===
            const existingRecord = await this.positionModel.findByBackupId(oldRecord.ID);
            
            if (existingRecord) {
              totalSkipped++;
              logger.warn(`SKIP: ID cũ ${oldRecord.ID} đã tồn tại trong Id_backups (new ID: ${existingRecord.id})`);
              continue; // Bỏ qua, không insert
            }

            // Map dữ liệu từ cũ sang mới
            const newRecord = mapFieldValues(
              oldRecord,
              config.fieldMapping,
              config.defaultValues
            );

            // Tạo GUID mới cho id
            newRecord.id = this.generateGuid().toUpperCase();
            
            // Lưu GUID cũ vào Id_backups
            newRecord.Id_backups = oldRecord.ID;
            
            totalSavedToBackup++;

            logger.info(`Migrating: ${oldRecord.ID} → ${newRecord.id} (backup: ${newRecord.Id_backups})`);

            // Insert vào DB mới
            await this.positionModel.insertToNewDb(newRecord);
            totalInserted++;

          } catch (error) {
            totalErrors++;
            logger.error(`Lỗi migrate record ID ${oldRecord.ID}: ${error.message}`);
          }
        }

        // Log progress
        const processedRecords = (i + 1) * this.batchSize;
        const progress = calculatePercentage(
          Math.min(processedRecords, totalRecords),
          totalRecords
        );
        logger.info(`Progress: ${progress}% (${formatNumber(totalInserted)} inserted, ${totalSkipped} skipped, ${totalErrors} errors)`);
      }

      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);

      logger.info('=== HOÀN THÀNH MIGRATION ===');
      logger.info(`Tổng thời gian: ${duration}s`);
      logger.info(`Tổng số bản ghi: ${formatNumber(totalRecords)}`);
      logger.info(`Đã insert: ${formatNumber(totalInserted)}`);
      logger.info(`GUID cũ lưu vào Id_backups: ${formatNumber(totalSavedToBackup)}`);
      logger.info(`Bỏ qua (đã tồn tại): ${formatNumber(totalSkipped)}`);
      logger.info(`Lỗi: ${formatNumber(totalErrors)}`);

      return {
        success: true,
        total: totalRecords,
        inserted: totalInserted,
        savedToBackup: totalSavedToBackup,
        skipped: totalSkipped,
        errors: totalErrors,
        duration: duration
      };

    } catch (error) {
      logger.error('Lỗi trong quá trình migration:', error);
      throw error;
    }
  }

  // Lấy thống kê migration phòng ban
  async getPhongBanStatistics() {
    try {
      const oldCount = await this.phongBanModel.countOldDb();
      const newCount = await this.phongBanModel.countNewDb();

      return {
        source: {
          database: 'DataEOfficeSNP',
          table: 'PhongBan',
          count: oldCount
        },
        destination: {
          database: 'camunda',
          table: 'organization_units',
          count: newCount
        },
        migrated: newCount,
        remaining: oldCount - newCount,
        percentage: calculatePercentage(newCount, oldCount)
      };
    } catch (error) {
      logger.error('Lỗi lấy thống kê phòng ban:', error);
      throw error;
    }
  }

  // Lấy thống kê migration position
  async getPositionStatistics() {
    try {
      const oldCount = await this.positionModel.countOldDb();
      const newCount = await this.positionModel.countNewDb();

      return {
        source: {
          database: 'DataEOfficeSNP',
          table: 'Position',
          count: oldCount
        },
        destination: {
          database: 'camunda',
          table: 'organization_units',
          note: 'Cùng bảng với PhongBan, phân biệt bằng table_backups',
          count: newCount
        },
        migrated: newCount,
        remaining: oldCount - newCount,
        percentage: calculatePercentage(newCount, oldCount)
      };
    } catch (error) {
      logger.error('Lỗi lấy thống kê position:', error);
      throw error;
    }
  }

  // Lấy tất cả thống kê
  async getAllStatistics() {
    try {
      const phongBanStats = await this.getPhongBanStatistics();
      const positionStats = await this.getPositionStatistics();

      return {
        phongban: phongBanStats,
        position: positionStats
      };
    } catch (error) {
      logger.error('Lỗi lấy thống kê:', error);
      throw error;
    }
  }

  // Kiểm tra kết nối
  async checkConnections() {
    try {
      const oldPhongBanCount = await this.phongBanModel.countOldDb();
      const newPhongBanCount = await this.phongBanModel.countNewDb();
      const oldPositionCount = await this.positionModel.countOldDb();
      const newPositionCount = await this.positionModel.countNewDb();

      return {
        oldDb: {
          connected: true,
          tables: {
            PhongBan: oldPhongBanCount,
            Position: oldPositionCount
          }
        },
        newDb: {
          connected: true,
          tables: {
            organization_units_phongban: newPhongBanCount,
            organization_units_position: newPositionCount,
            note: 'Cùng 1 bảng organization_units, phân biệt bằng table_backups'
          }
        }
      };
    } catch (error) {
      logger.error('Lỗi kiểm tra kết nối:', error);
      throw error;
    }
  }

  // Đóng kết nối
  async close() {
    await this.phongBanModel.close();
    await this.positionModel.close();
    logger.info('Đã đóng tất cả kết nối');
  }
}

module.exports = MigrationService;
/**
 * ============================================================
 * FILE 3: services/MigrationDonViService.js
 * ============================================================
 * Mục đích: Service xử lý logic migration DonVi
 * ============================================================
 */

const DonViModel = require('../models/DonViModel');
const { tableMappings } = require('../config/tablesDonVi');
const { mapFieldValues, chunkArray, formatNumber, calculatePercentage } = require('../utils/helpers');
const logger = require('../utils/logger');

class MigrationDonViService {
  constructor() {
    this.donViModel = new DonViModel();
    this.batchSize = parseInt(process.env.BATCH_SIZE || '100');
  }

  /**
   * KHỞI TẠO SERVICE
   */
  async initialize() {
    try {
      await this.donViModel.initialize();
      logger.info('Migration DonVi Service đã được khởi tạo');
    } catch (error) {
      logger.error('Lỗi khởi tạo Migration DonVi Service:', error);
      throw error;
    }
  }

  /**
   * TẠO GUID MỚI (UUID v4)
   * @returns {string} GUID mới
   */
  generateGuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * MIGRATION ĐƠN VỊ - HÀM CHÍNH
   * @returns {Promise<Object>} Kết quả migration
   */
  async migrateDonVi() {
    const startTime = Date.now();
    logger.info('=== BẮT ĐẦU MIGRATION ĐƠN VỊ ===');

    try {
      // BƯỚC 1: LẤY CẤU HÌNH MAPPING
      const config = tableMappings.donvi;
      
      // BƯỚC 2: ĐÉM SỐ RECORD NGUỒN
      const totalRecords = await this.donViModel.countOldDb();
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

      // BƯỚC 3: LẤY TẤT CẢ DỮ LIỆU TỪ DB CŨ
      logger.info('Đang lấy dữ liệu từ database cũ...');
      const oldRecords = await this.donViModel.getAllFromOldDb();
      logger.info(`Đã lấy ${formatNumber(oldRecords.length)} bản ghi`);

      // BƯỚC 4: CHIA THÀNH CÁC BATCH
      const batches = chunkArray(oldRecords, this.batchSize);
      logger.info(`Chia thành ${batches.length} batch (${this.batchSize} records/batch)`);

      // BIẾN ĐẾM
      let totalInserted = 0;
      let totalSavedToBackup = 0;
      let totalSkipped = 0;
      let totalErrors = 0;

      // BƯỚC 5: XỬ LÝ TỪNG BATCH
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchNum = i + 1;
        
        logger.info(`Đang xử lý batch ${batchNum}/${batches.length}...`);

        for (const oldRecord of batch) {
          try {
            // BƯỚC 5.1: CONVERT DONVIID (NUMERIC) SANG STRING
            // ⚠️ QUAN TRỌNG: DonViID là numeric, phải convert sang string
            const backupId = oldRecord.DonViID ? oldRecord.DonViID.toString() : null;
            
            if (!backupId) {
              totalErrors++;
              logger.error(`SKIP: Record không có DonViID hợp lệ`);
              continue;
            }

            // BƯỚC 5.2: KIỂM TRA TRÙNG LẶP
            const existingRecord = await this.donViModel.findByBackupId(backupId);
            
            if (existingRecord) {
              totalSkipped++;
              logger.warn(`SKIP: ID cũ ${backupId} đã tồn tại trong Id_backups (new ID: ${existingRecord.id})`);
              continue;
            }

            // BƯỚC 5.3: MAP DỮ LIỆU TỪ CŨ SANG MỚI
            const newRecord = mapFieldValues(
              oldRecord,
              config.fieldMapping,
              config.defaultValues
            );

            // BƯỚC 5.4: TẠO GUID MỚI CHO ID
            newRecord.id = this.generateGuid().toUpperCase();
            
            // BƯỚC 5.5: LƯU ID CŨ VÀO ID_BACKUPS
            newRecord.Id_backups = backupId;  // Đã convert sang string
            
            totalSavedToBackup++;

            logger.info(`Migrating: ${backupId} → ${newRecord.id} (backup: ${newRecord.Id_backups})`);

            // BƯỚC 5.6: INSERT VÀO DB MỚI
            await this.donViModel.insertToNewDb(newRecord);
            totalInserted++;

          } catch (error) {
            totalErrors++;
            logger.error(`Lỗi migrate record DonViID ${oldRecord.DonViID}: ${error.message}`);
          }
        }

        // LOG PROGRESS SAU MỖI BATCH
        const processedRecords = (i + 1) * this.batchSize;
        const progress = calculatePercentage(
          Math.min(processedRecords, totalRecords),
          totalRecords
        );
        logger.info(`Progress: ${progress}% (${formatNumber(totalInserted)} inserted, ${totalSkipped} skipped, ${totalErrors} errors)`);
      }

      // BƯỚC 6: TÍNH TOÁN KẾT QUẢ
      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);

      logger.info('=== HOÀN THÀNH MIGRATION ===');
      logger.info(`Tổng thời gian: ${duration}s`);
      logger.info(`Tổng số bản ghi: ${formatNumber(totalRecords)}`);
      logger.info(`Đã insert: ${formatNumber(totalInserted)}`);
      logger.info(`ID cũ lưu vào Id_backups: ${formatNumber(totalSavedToBackup)}`);
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

  /**
   * LẤY THỐNG KÊ MIGRATION
   * @returns {Promise<Object>} Thống kê chi tiết
   */
  async getStatistics() {
    try {
      const oldCount = await this.donViModel.countOldDb();
      const newCount = await this.donViModel.countNewDb();

      return {
        source: {
          database: 'DataEOfficeSNP',
          table: 'DonVi',
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
      logger.error('Lỗi lấy thống kê đơn vị:', error);
      throw error;
    }
  }

  /**
   * ĐÓNG KẾT NỐI
   */
  async close() {
    await this.donViModel.close();
    logger.info('Đã đóng tất cả kết nối');
  }
}

module.exports = MigrationDonViService;
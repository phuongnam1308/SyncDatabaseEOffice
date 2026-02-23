const logger = require('../../../utils/logger');
const StreamOutgoingMigrationModel = require('./StreamOutgoingMigrationModel');

/**
 * StreamOutgoingMigrationService
 * 
 * Service tổng hợp tất cả logic migration văn bản đi
 * Xử lý batch processing và insert trực tiếp vào DB mới
 * Không sử dụng bảng trung gian
 * 
 * Quy trình:
 * 1. Lấy batch từ DB cũ
 * 2. Map và clean data
 * 3. Insert/Update vào DB mới
 * 4. Lặp lại cho đến khi hết data
 */
class StreamOutgoingMigrationService {

  constructor() {
    this.model = null;
    this.defaultBatchSize = 100;
  }

  /**
   * Khởi tạo model
   */
  async initialize() {
    try {
      this.model = new StreamOutgoingMigrationModel();
      await this.model.initialize();
      logger.info('[StreamOutgoingMigrationService] Initialized successfully');
    } catch (error) {
      logger.error('[StreamOutgoingMigrationService] Initialize error:', error);
      throw new Error(`Không thể khởi tạo service: ${error.message}`);
    }
  }

  /**
   * Lấy trạng thái migration hiện tại
   * @returns {Promise<Object>} Thông tin trạng thái
   */
  async getStatus() {
    try {
      if (!this.model) {
        throw new Error('Service chưa được khởi tạo');
      }

      const status = await this.model.getStatus();

      return {
        totalInOldDb: status.totalInOldDb || 0,
        totalInNewDb: status.totalInNewDb || 0,
        remaining: status.remaining || 0,
        lastMigratedId: status.lastMigratedId || null
      };
    } catch (error) {
      logger.error('[StreamOutgoingMigrationService.getStatus] Error:', error);
      throw error;
    }
  }

  /**
   * Thực hiện migration theo batch
   * 
   * @param {Object} options - Tùy chọn migration
   * @param {number} options.limit - Tổng số bản ghi cần migrate (0 = tất cả)
   * @param {number} options.batch - Số lượng bản ghi mỗi batch
   * @returns {Promise<Object>} Kết quả migration
   */
  async migrate({ limit = 0, batch = this.defaultBatchSize, lastProcessedId = 0 } = {}) {
    const startTime = Date.now();

    // Validate
    if (!this.model) {
      throw new Error('Service chưa được khởi tạo. Gọi initialize() trước.');
    }

    if (batch <= 0) {
      throw new Error('Batch size phải lớn hơn 0');
    }

    if (limit < 0) {
      throw new Error('Limit không được âm');
    }

    logger.info('='.repeat(80));
    logger.info(`[StreamOutgoingMigrationService] BẮT ĐẦU MIGRATION`);
    logger.info(`├─ Limit: ${limit || 'ALL'}`);
    logger.info(`├─ Batch Size: ${batch}`);
    logger.info('='.repeat(80));

    let totalInserted = 0;
    let totalUpdated = 0;
    let totalProcessed = 0;
    let batchCount = 0;
    let hasMore = true;

    try {
      while (hasMore) {
        batchCount++;
        const batchStartTime = Date.now();

        logger.info('');
        logger.info(`┌─ BATCH ${batchCount} ─────────────────────────────────────`);

        try {
          // === BƯỚC 1: LẤY DỮ LIỆU TỪ DB CŨ ===
          logger.info(`│  📥 Fetching ${batch} records from OLD DB...`);
          const oldRecords = await this.model.fetchBatchFromOldDb({
            batch,
            lastId: lastProcessedId
          });

          if (!oldRecords || oldRecords.length === 0) {
            logger.info(`│  ℹ️  No more records to process`);
            hasMore = false;
            break;
          }

          logger.info(`│  ✓ Fetched ${oldRecords.length} records`);

          // === BƯỚC 2: MAP VÀ CLEAN DATA ===
          logger.info(`│  🔄 Mapping and cleaning data...`);
          const mappedRecords = await this.model.mapAndCleanBatch(oldRecords);
          logger.info(`│  ✓ Mapped ${mappedRecords.length} records`);

          // === BƯỚC 3: INSERT/UPDATE VÀO DB MỚI ===
          logger.info(`│  💾 Inserting/Updating to NEW DB...`);
          const batchResult = await this.model.insertBatchToNewDb(mappedRecords);

          const inserted = batchResult.inserted || 0;
          const updated = batchResult.updated || 0;

          totalInserted += inserted;
          totalUpdated += updated;
          totalProcessed += oldRecords.length;

          // Update last processed ID
          if (oldRecords.length > 0) {
            lastProcessedId = oldRecords[oldRecords.length - 1].ID;
          }

          const batchDuration = ((Date.now() - batchStartTime) / 1000).toFixed(2);

          logger.info(`│  ✓ Inserted: ${inserted}, Updated: ${updated}`);
          logger.info(`│  ⏱️  Batch duration: ${batchDuration}s`);
          logger.info(`└──────────────────────────────────────────────────`);

          // === KIỂM TRA LIMIT ===
          if (limit > 0 && totalProcessed >= limit) {
            logger.info('');
            logger.info(`⚠️  Reached limit (${limit}). Stopping...`);
            hasMore = false;
            break;
          }

          // === KIỂM TRA XEM CÓ BATCH TIẾP THEO KHÔNG ===
          if (oldRecords.length < batch) {
            logger.info('');
            logger.info(`ℹ️  Last batch (received ${oldRecords.length} < ${batch}). Stopping...`);
            hasMore = false;
            break;
          }

        } catch (batchError) {
          // Log lỗi batch nhưng không throw để có thể tiếp tục
          logger.error(`│  ❌ BATCH ${batchCount} ERROR:`, {
            message: batchError.message,
            stack: batchError.stack
          });

          // Throw lỗi để dừng migration
          throw new Error(`Batch ${batchCount} failed: ${batchError.message}`);
        }
      }

      // === TỔNG KẾT ===
      const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info('');
      logger.info('='.repeat(80));
      logger.info('✅ MIGRATION HOÀN TẤT THÀNH CÔNG');
      logger.info('─'.repeat(80));
      logger.info(`├─ Total Processed: ${totalProcessed}`);
      logger.info(`├─ Total Inserted: ${totalInserted}`);
      logger.info(`├─ Total Updated: ${totalUpdated}`);
      logger.info(`├─ Total Batches: ${batchCount}`);
      logger.info(`├─ Total Duration: ${totalDuration}s`);
      logger.info(`└─ Avg per batch: ${(parseFloat(totalDuration) / batchCount).toFixed(2)}s`);
      logger.info('='.repeat(80));

      return {
        inserted: totalInserted,
        updated: totalUpdated,
        totalProcessed,
        batches: batchCount,
        duration: totalDuration
      };

    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.error('');
      logger.error('='.repeat(80));
      logger.error('❌ MIGRATION FAILED');
      logger.error('─'.repeat(80));
      logger.error(`├─ Error: ${error.message}`);
      logger.error(`├─ Processed before error: ${totalProcessed}`);
      logger.error(`├─ Inserted before error: ${totalInserted}`);
      logger.error(`├─ Updated before error: ${totalUpdated}`);
      logger.error(`├─ Batches completed: ${batchCount}`);
      logger.error(`└─ Duration: ${duration}s`);
      logger.error('='.repeat(80));
      logger.error('Stack trace:', error.stack);

      // Re-throw để controller xử lý
      throw error;
    }
  }

  /**
   * Rollback migration (nếu cần)
   * @param {Object} options - Tùy chọn rollback
   * @returns {Promise<Object>} Kết quả rollback
   */
  async rollback(options = {}) {
    try {
      if (!this.model) {
        throw new Error('Service chưa được khởi tạo');
      }

      logger.info('[StreamOutgoingMigrationService] Starting rollback...');
      const result = await this.model.rollback(options);
      logger.info('[StreamOutgoingMigrationService] Rollback completed');

      return result;
    } catch (error) {
      logger.error('[StreamOutgoingMigrationService.rollback] Error:', error);
      throw error;
    }
  }
}

module.exports = StreamOutgoingMigrationService;
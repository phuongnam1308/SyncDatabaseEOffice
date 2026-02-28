const logger = require("../../../utils/logger");
const SyncCommentModel = require("./SyncCommentModel");

class SyncCommentService {
  constructor() {
    this.model = null;
    this.defaultBatchSize = 100;
  }

  async initialize() {
    this.model = new SyncCommentModel();
    await this.model.initialize();
    logger.info("[SyncCommentService] Initialized successfully");
  }

  async getStatus() {
    if (!this.model) throw new Error("Service chưa được khởi tạo");
    return this.model.getStatus();
  }

  async sync({ limit = 0, batch = this.defaultBatchSize, lastProcessedId = 0 } = {}) {
    if (!this.model) throw new Error("Service chưa được khởi tạo");
    if (batch <= 0) throw new Error("Batch size phải lớn hơn 0");

    const startTime = Date.now();
    let totalInserted = 0;
    let totalUpdated = 0;
    let totalProcessed = 0;
    let batchCount = 0;
    let hasMore = true;

    logger.info("=".repeat(60));
    logger.info("[SyncCommentService] BẮT ĐẦU SYNC DOCUMENT_COMMENTS");
    logger.info(`├─ Limit: ${limit || "ALL"} | Batch: ${batch}`);
    logger.info("=".repeat(60));

    try {
      while (hasMore) {
        batchCount++;
        const syncRecords = await this.model.fetchBatchFromSync({ batch, lastId: lastProcessedId });

        if (!syncRecords?.length) {
          hasMore = false;
          break;
        }

        logger.info(`[BATCH ${batchCount}] Fetched: ${syncRecords.length}`);
        const result = await this.model.insertBatchToMain(syncRecords);

        totalInserted += result.inserted || 0;
        totalUpdated += result.updated || 0;
        totalProcessed += syncRecords.length;

        lastProcessedId = syncRecords[syncRecords.length - 1].id;

        logger.info(`[BATCH ${batchCount}] Inserted: ${result.inserted} | Updated: ${result.updated}`);

        if (limit > 0 && totalProcessed >= limit) { hasMore = false; break; }
        if (syncRecords.length < batch) { hasMore = false; break; }
      }

      const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.info("=".repeat(60));
      logger.info(`✅ SYNC HOÀN TẤT | Processed: ${totalProcessed} | Inserted: ${totalInserted} | Updated: ${totalUpdated} | ${totalDuration}s`);
      logger.info("=".repeat(60));

      return { inserted: totalInserted, updated: totalUpdated, totalProcessed, batches: batchCount, duration: totalDuration };
    } catch (error) {
      logger.error("[SyncCommentService] Sync error:", error);
      throw error;
    }
  }
}

module.exports = SyncCommentService;

const logger = require("../../utils/logger");
const Model = require("./StreamAuditMigrationModel");

class StreamAuditSyncService {
  constructor() {
    this.defaultBatch = 200;
  }

  async migrate({ tables = [], limit = 0, batch = this.defaultBatch }) {
    if (!Array.isArray(tables) || tables.length === 0)
      throw new Error("Tables không hợp lệ");

    if (batch <= 0) throw new Error("Batch phải > 0");
    if (limit < 0) throw new Error("Limit không hợp lệ");

    const summary = [];

    for (const table of tables) {
      const model = new Model(table);
      await model.initialize();

      logger.info(`==============================`);
      logger.info(`[AUDIT SYNC] START TABLE: ${table}`);
      logger.info(`Batch size: ${batch} | Limit: ${limit || "ALL"}`);
      logger.info(`==============================`);

      let lastId = null;
      let totalInserted = 0;
      let totalUpdated = 0;
      let totalProcessed = 0;
      let batchCount = 0;

      while (true) {
        const records = await model.fetchBatch({
          batch,
          lastId,
        });

        if (!records?.length) break;

        logger.info(
          `[${table}] >>> BATCH ${batchCount} START | Records: ${records.length} | ID: ${records.ID}`
        );
        const result = await model.upsertBatch(records);

        totalInserted += result.inserted;
        totalUpdated += result.updated;
        totalProcessed += records.length;
        batchCount++;
        logger.info(
          `[${table}] <<< BATCH ${batchCount} END | Inserted: ${result.inserted} | Updated: ${result.updated} | Total processed: ${totalProcessed}`
        );

        lastId = records[records.length - 1]?.ID;

        if (limit > 0 && totalProcessed >= limit) break;
        if (records.length < batch) break;
      }

      summary.push({
        table,
        inserted: totalInserted,
        updated: totalUpdated,
        processed: totalProcessed,
      });
    }

    return summary;
  }
}

module.exports = StreamAuditSyncService;

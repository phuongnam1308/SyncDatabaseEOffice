const logger = require("../../utils/logger");
const Model = require("./StreamOutgoingAuditMigrationModel");

class StreamOutgoingAuditSyncService {
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

      let lastId = null;
      let totalInserted = 0;
      let totalUpdated = 0;
      let totalProcessed = 0;

      while (true) {
        const records = await model.fetchBatch({
          batch,
          lastId,
        });

        if (!records?.length) break;

        const result = await model.upsertBatch(records);

        totalInserted += result.inserted;
        totalUpdated += result.updated;
        totalProcessed += records.length;

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

module.exports = StreamOutgoingAuditSyncService;

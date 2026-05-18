const logger = require('../../../utils/logger');
const UpsertHandler = require('./UpsertHandler');

class Loader {
  constructor(newPool, oldPool) {
    this.newPool = newPool;
    this.oldPool = oldPool;
    this.upsertHandler = new UpsertHandler(newPool, oldPool);
  }

  async initialize() {
    await this.upsertHandler.initialize();
  }

  async fetchBatchFromStaging(batchSize = 100) {
    const table = `task_sharepoint_sync`;
    const query = `
      SELECT TOP (@batchSize) *
      FROM ${table}
      WHERE MigrateFlg = 0 AND MigrateErrFlg = 0
      ORDER BY Modified DESC
    `;
    const result = await this.newPool.request()
      .input('batchSize', batchSize)
      .query(query);
    return result.recordset || [];
  }

  async markSuccess(ids) {
    if (!ids || ids.length === 0) return;
    const table = `task_sharepoint_sync`;
    const query = `UPDATE ${table} SET MigrateFlg = 1, MigrateErrMess = NULL WHERE ID IN (${ids.map(id => `'${id}'`).join(',')})`;
    await this.newPool.request().query(query);
  }

  async markFailed(failedRecords) {
    if (!failedRecords || failedRecords.length === 0) return;
    const table = `task_sharepoint_sync`;
    for (const record of failedRecords) {
      await this.newPool.request()
        .input('id', record.id)
        .input('error', record.error)
        .query(`UPDATE ${table} SET MigrateErrFlg = 1, MigrateErrMess = @error WHERE ID = @id`);
    }
  }

  async processRecords(records) {
    const result = await this.upsertHandler.processBatch(records);
    if (result.successIds.length > 0) {
      await this.markSuccess(result.successIds);
    }
    if (result.failedRecords.length > 0) {
      await this.markFailed(result.failedRecords);
    }
    return result;
  }
}

module.exports = Loader;

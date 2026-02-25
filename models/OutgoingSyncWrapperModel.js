// models/OutgoingSyncWrapperModel.js
/**
 * Wrapper model cho sync outgoing_documents2 → outgoing_documents
 * Kompatibel với SyncManagerService
 */
const BaseModel = require('./BaseModel');
const SyncOutgoingService = require('../services/SyncOutgoingService');
const OutgoingSyncModel = require('./OutgoingSyncModel');
const logger = require('../utils/logger');

class OutgoingSyncWrapperModel extends BaseModel {
  constructor() {
    super();
    this.service = null;
    this.underlyingModel = null;
  }

  async initialize() {
    await super.initialize();
    this.underlyingModel = new OutgoingSyncModel();
    await this.underlyingModel.initialize();
    this.service = new SyncOutgoingService(this.underlyingModel);
  }

  /**
   * Get count of records that need to be synced
   * Implements SyncManagerService compatibility
   */
  async getAllFromOldDb() {
    // Delegate to underlying model to get array of records
    return await this.underlyingModel.getAllFromOldDb();
  }

  /**
   * Perform sync operation (batch-based)
   * Implements SyncManagerService compatibility
   */
  async sync() {
    try {
      logger.info('[OutgoingSyncWrapperModel] Starting sync...');
      const result = await this.service.sync(100); // batchSize = 100
      logger.info(`[OutgoingSyncWrapperModel] Sync complete: ${result.totalInserted} inserted`);
      return result.totalInserted || 0;
    } catch (error) {
      logger.error('[OutgoingSyncWrapperModel] Sync error:', error);
      throw error;
    }
  }

  async updateInNewDb(record) {
    return await this.underlyingModel.updateInNewDb(record);
  }

  async insertToNewDb(record) {
    return await this.underlyingModel.insertToNewDb(record);
  }

  async countOldDb() {
    const preview = await this.underlyingModel.preview();
    return preview.total_can_sync || 0;
  }

  async countNewDb() {
    // Return count of already synced
    const query = `
      SELECT COUNT(*) AS total
      FROM DiOffice.dbo.outgoing_documents
    `;
    const { recordset } = await this.newPool.request().query(query);
    return recordset[0].total || 0;
  }
}

module.exports = OutgoingSyncWrapperModel;

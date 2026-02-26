const BaseModel = require('../../models/BaseModel');

class BaseIncrementalSyncInterface extends BaseModel {
  constructor(options = {}) {
    super();
    this.modelName = options.modelName || this.constructor.name;
  }

  async fetchListFromOldDb(_lastSyncTime) {
    throw new Error(`[${this.modelName}] fetchListFromOldDb(lastSyncTime) must be implemented`);
  }

  async processRowData(_rowData, _context = {}) {
    throw new Error(`[${this.modelName}] processRowData(rowData, context) must be implemented`);
  }

  async syncOldToStaging(_rows, _context = {}) {
    // This method is optional
  }

  async getList(_lastSyncTime, _syncJobId, _lastSyncId = 0) {
    throw new Error(`[${this.modelName}] getList(lastSyncTime, syncJobId, lastSyncId) must be implemented`);
  }

  async processOne(_syncJobId, _options = {}) {
    throw new Error(`[${this.modelName}] processOne(syncJobId, options) must be implemented`);
  }

  async getSyncJobState(_syncJobId) {
    // This method is optional
    return null;
  }

  async fetchOneFromStaging(_context = {}) {
    // This method is optional
  }
}

module.exports = BaseIncrementalSyncInterface;

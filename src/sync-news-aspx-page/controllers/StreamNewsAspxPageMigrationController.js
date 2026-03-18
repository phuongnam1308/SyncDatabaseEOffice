const StreamNewsAspxPageMigrationService = require('../services/StreamNewsAspxPageMigrationService');

class StreamNewsAspxPageMigrationController {
  constructor() {
    this.service = new StreamNewsAspxPageMigrationService();
    this.testGetList = this.testGetList.bind(this);
    this.testProcessOne = this.testProcessOne.bind(this);
  }

  async ensureInitialized() {
    await this.service.initialize();
  }

  async testGetList(req, res) {
    await this.ensureInitialized();
    const payload = await this.service.testGetList(req.body || {});
    return res.json(payload);
  }

  async testProcessOne(req, res) {
    await this.ensureInitialized();
    const { syncJobId, ...options } = req.body || {};
    const payload = await this.service.testProcessOne(syncJobId, options);
    return res.json(payload);
  }
}

module.exports = new StreamNewsAspxPageMigrationController();


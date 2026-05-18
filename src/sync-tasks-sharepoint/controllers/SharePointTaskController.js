const logger = require('../../../utils/logger');
const SyncTaskSharePointModel = require('../models/SyncTaskSharePointModel');

class SharePointTaskController {
  constructor() {
    this.model = new SyncTaskSharePointModel();
  }

  async processAll(req, res) {
    try {
      const { syncJobId } = req.body;
      const model = new SyncTaskSharePointModel();
      await model.initialize(null, syncJobId);
      
      // Run in background
      model.run().then(result => {
        logger.info(`[SharePointTaskController] Sync finished: ${JSON.stringify(result)}`);
      }).catch(err => {
        logger.error(`[SharePointTaskController] Sync failed: ${err.message}`);
      });

      res.json({ success: true, message: 'Sync started in background' });
    } catch (error) {
      logger.error(`[SharePointTaskController] processAll error: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getSyncStats(req, res) {
    try {
      const { syncJobId } = req.params;
      const model = new SyncTaskSharePointModel();
      await model.initialize(null, syncJobId);
      const progress = await model.getProgress();
      res.json({ success: true, data: progress });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
}

module.exports = new SharePointTaskController();

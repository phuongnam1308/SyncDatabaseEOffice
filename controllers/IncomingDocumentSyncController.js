// controllers/IncomingDocumentSyncController.js
const IncomingDocumentSyncService = require('../services/IncomingDocumentSyncService');
const logger = require('../utils/logger');

class IncomingDocumentSyncController {
  static async sync(req, res) {
    try {
      logger.info('API sync/incoming-documents được gọi');
      const service = new IncomingDocumentSyncService();
      const result = await service.performSync();
      logger.info('API sync hoàn tất', result);
      res.json({ success: true, data: result });
    } catch (err) {
      logger.error('Lỗi API sync:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  }

  static async status(req, res) {
    try {
      logger.info('API statistics/incoming-sync-status được gọi');
      const service = new IncomingDocumentSyncService();
      const stats = await service.getStatus();
      res.json({ success: true, data: stats });
    } catch (err) {
      logger.error('Lỗi API status:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  }
}

module.exports = IncomingDocumentSyncController;
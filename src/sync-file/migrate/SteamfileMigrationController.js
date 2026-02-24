const BaseController = require('../../../controllers/BaseController');
const logger = require('../../../utils/logger');
const StreamFileMigrationService = require('./SteamFileMigrationSerivce');

class StreamFileMigrationController extends BaseController {
  constructor() {
    super();
    this.service = new StreamFileMigrationService();
  }

  runStreamMigration = this.asyncHandler(async (req, res) => {
    const startTime = Date.now();

    const limit = parseInt(req.body?.limit || req.query?.limit || 0, 10);
    const batch = parseInt(req.body?.batch || req.query?.batch || 100, 10);
    const lastProcessedId = parseInt(
      req.body?.lastProcessedId || req.query?.lastProcessedId || 0,
      10
    );

    if (batch <= 0) {
      return this.error(res, 'Batch size phai lon hon 0', 400);
    }

    if (limit < 0) {
      return this.error(res, 'Limit khong duoc am', 400);
    }

    try {
      await this.service.initialize();
      const result = await this.service.migrate({ limit, batch, lastProcessedId });

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      return this.success(
        res,
        {
          inserted: result.inserted || 0,
          updated: result.updated || 0,
          totalProcessed: result.totalProcessed || 0,
          batches: result.batches || 0,
          duration: `${duration}s`
        },
        'Migration file hoan tat thanh cong'
      );
    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.error(`[StreamFileMigrationController] Migration failed after ${duration}s:`, error);
      return this.error(res, 'Migration bi loi giua chung', 500, {
        error: error.message,
        duration: `${duration}s`
      });
    }
  });

  getStatus = this.asyncHandler(async (req, res) => {
    try {
      await this.service.initialize();
      const status = await this.service.getStatus();
      return this.success(res, status, 'Lay trang thai thanh cong');
    } catch (error) {
      logger.error('[StreamFileMigrationController.getStatus] Error:', error);
      return this.error(res, 'Khong the lay trang thai', 500, {
        error: error.message
      });
    }
  });
}

module.exports = new StreamFileMigrationController();

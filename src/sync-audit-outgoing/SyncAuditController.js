// sync-audit.controller.js
const BaseController = require('../../controllers/BaseController');
const logger = require('../../utils/logger');
const SyncAuditService = require('./SyncAuditService');

class SyncAuditController extends BaseController {
  constructor() {
    super();
    this.service = new SyncAuditService();
  }

  /**
   * @swagger
   * /sync/audit:
   *   post:
   *     summary: Sync audit từ bảng sync sang bảng chính theo batch
   *     tags: [Sync Audit]
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               limit:
   *                 type: integer
   *                 description: Tổng số bản ghi cần sync (0 = tất cả)
   *                 default: 0
   *               batch:
   *                 type: integer
   *                 description: Số lượng bản ghi mỗi batch
   *                 default: 100
   *               lastProcessedId:
   *                 type: integer
   *                 description: ID bắt đầu sync từ (>= ID này)
   *                 default: 0
   *     responses:
   *       200:
   *         description: Sync thành công
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 message:
   *                   type: string
   *                 data:
   *                   type: object
   *                   properties:
   *                     inserted:
   *                       type: integer
   *                     updated:
   *                       type: integer
   *                     duration:
   *                       type: string
   *                     totalProcessed:
   *                       type: integer
   *                     batches:
   *                       type: integer
   *       500:
   *         description: Lỗi server
   */
  syncToMain = this.asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const { limit = 0, batch = 100, lastProcessedId = 0 } = req.body;

    if (batch <= 0) {
      return this.error(res, 'Batch size phải lớn hơn 0', 400);
    }

    logger.info(`🚀 BẮT ĐẦU SYNC AUDIT - Limit: ${limit || 'ALL'}, Batch: ${batch}`);

    try {
      await this.service.initialize();
      const result = await this.service.sync({ limit, batch, lastProcessedId });
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info(`✅ SYNC AUDIT HOÀN TẤT - Inserted: ${result.inserted}, Updated: ${result.updated}, Duration: ${duration}s`);

      return this.success(res, {
        inserted: result.inserted,
        updated: result.updated,
        totalProcessed: result.totalProcessed,
        batches: result.batches,
        duration: `${duration}s`
      }, 'Sync audit hoàn tất thành công');

    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.error(`❌ LỖI SYNC AUDIT sau ${duration}s:`, error);
      return this.error(res, 'Sync audit bị lỗi', 500, { error: error.message, duration: `${duration}s` });
    }
  });

  /**
   * @swagger
   * /sync/audit/status:
   *   get:
   *     summary: Kiểm tra trạng thái sync audit
   *     tags: [Sync Audit]
   *     responses:
   *       200:
   *         description: Thông tin trạng thái
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 message:
   *                   type: string
   *                 data:
   *                   type: object
   *                   properties:
   *                     totalInSync:
   *                       type: integer
   *                       description: Tổng số bản ghi trong bảng audit_sync
   *                     totalInMain:
   *                       type: integer
   *                       description: Tổng số bản ghi trong bảng audit
   *                     remaining:
   *                       type: integer
   *                       description: Số bản ghi còn lại cần sync
   *       500:
   *         description: Lỗi server
   */
  getStatus = this.asyncHandler(async (req, res) => {
    try {
      await this.service.initialize();
      const status = await this.service.getStatus();
      return this.success(res, status, 'Lấy trạng thái audit thành công');
    } catch (error) {
      logger.error('Lỗi lấy status audit:', error);
      return this.error(res, 'Không thể lấy trạng thái audit', 500, { error: error.message });
    }
  });
}

module.exports = new SyncAuditController();
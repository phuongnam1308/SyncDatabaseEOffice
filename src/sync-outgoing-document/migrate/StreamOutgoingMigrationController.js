const BaseController = require('../../../controllers/BaseController');
const logger = require('../../../utils/logger');
const StreamOutgoingMigrationService = require('./StreamOutgoingMigrationService');

/**
 * StreamOutgoingMigrationController
 * 
 * Controller đơn giản cho việc migration văn bản đi theo batch
 * Chỉ nhận params (limit, batch) và delegate toàn bộ logic cho Service
 * 
 * @extends BaseController
 */
class StreamOutgoingMigrationController extends BaseController {
  
  constructor() {
    super();
    this.service = new StreamOutgoingMigrationService();
  }

  /**
   * @swagger
   * /migrate/stream-outgoing:
   *   post:
   *     summary: Migration văn bản đi theo batch stream (insert trực tiếp vào DB mới)
   *     tags: [Migration Stream]
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               limit:
   *                 type: number
   *                 description: Tổng số bản ghi cần migrate (0 = tất cả)
   *                 default: 0
   *               batch:
   *                 type: number
   *                 description: Số lượng bản ghi mỗi batch
   *                 default: 100
   *     responses:
   *       200:
   *         description: Migration thành công
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
   *                       type: number
   *                     updated:
   *                       type: number
   *                     duration:
   *                       type: string
   *                     totalProcessed:
   *                       type: number
   *                     batches:
   *                       type: number
   *       500:
   *         description: Lỗi server
   */
  runStreamMigration = this.asyncHandler(async (req, res) => {
    const startTime = Date.now();
    
    // Lấy params từ request body hoặc query
    const limit = parseInt(req.body?.limit || req.query?.limit || 0);
    const batch = parseInt(req.body?.batch || req.query?.batch || 100);
    const lastProcessedId = parseInt(req.body?.lastProcessedId || req.query?.lastProcessedId || 0);

    // Validate params
    if (batch <= 0) {
      return this.error(res, 'Batch size phải lớn hơn 0', 400);
    }

    if (limit < 0) {
      return this.error(res, 'Limit không được âm', 400);
    }

    logger.info(`🚀 BẮT ĐẦU STREAM MIGRATION - Limit: ${limit || 'ALL'}, Batch: ${batch}`);

    try {
      // Khởi tạo service
      await this.service.initialize();

      // Thực hiện migration
      const result = await this.service.migrate({ limit, batch, lastProcessedId });

      // Tính thời gian thực thi
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      // Format response theo chuẩn
      const response = {
        success: true,
        message: 'Migration văn bản đi hoàn tất thành công',
        data: {
          inserted: result.inserted || 0,
          updated: result.updated || 0,
          totalProcessed: result.totalProcessed || 0,
          batches: result.batches || 0,
          duration: `${duration}s`
        }
      };

      logger.info(`✅ STREAM MIGRATION HOÀN TẤT - Inserted: ${response.data.inserted}, Updated: ${response.data.updated}, Duration: ${response.data.duration}`);

      return this.success(res, response.data, response.message);

    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      
      logger.error(`❌ LỖI STREAM MIGRATION sau ${duration}s:`, {
        message: error.message,
        stack: error.stack
      });

      return this.error(res, 'Migration bị lỗi giữa chừng', 500, {
        error: error.message,
        duration: `${duration}s`
      });
    }
  });

  /**
   * @swagger
   * /migrate/stream-outgoing/status:
   *   get:
   *     summary: Kiểm tra trạng thái migration
   *     tags: [Migration Stream]
   *     responses:
   *       200:
   *         description: Thông tin trạng thái
   */
  getStatus = this.asyncHandler(async (req, res) => {
    try {
      await this.service.initialize();
      const status = await this.service.getStatus();

      return this.success(res, status, 'Lấy trạng thái thành công');
    } catch (error) {
      logger.error('Lỗi lấy status:', error);
      return this.error(res, 'Không thể lấy trạng thái', 500, {
        error: error.message
      });
    }
  });
}

module.exports = new StreamOutgoingMigrationController();
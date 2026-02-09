// controllers/MigrationTask2ToTaskController.js
const BaseController = require('./BaseController');
const MigrationTask2ToTaskService = require('../services/MigrationTask2ToTaskService');
const logger = require('../utils/logger');

class MigrationTask2ToTaskController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new MigrationTask2ToTaskService();
      await this.service.initialize();
    }
  }

  /**
   * @swagger
   * /migrate/task2toTask/stats:
   *   get:
   *     summary: Thống kê migration task2 → task
   *     tags: [Dong bo cong viec]
   *     responses:
   *       200:
   *         description: Thống kê số lượng bản ghi
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 source:
   *                   type: object
   *                   properties:
   *                     table:
   *                       type: string
   *                       example: task2
   *                     count:
   *                       type: number
   *                       example: 1200
   *                 destination:
   *                   type: object
   *                   properties:
   *                     table:
   *                       type: string
   *                       example: task
   *                     count:
   *                       type: number
   *                       example: 1180
   *                 migrated:
   *                   type: number
   *                   example: 1180
   *                 remaining:
   *                   type: number
   *                   example: 20
   *                 percentage:
   *                   type: string
   *                   example: "98.33%"
   */
  getStatistics = this.asyncHandler(async (req, res) => {
    await this.initService();
    const stats = await this.service.getStatistics();
    return this.success(res, stats, 'Thống kê task2 → task');
  });

  /**
   * @swagger
   * /migrate/task2toTask:
   *   get:
   *     summary: Migration dữ liệu từ task2 sang task
   *     tags: [Dong bo cong viec]
   *     description: |
   *       - Copy toàn bộ dữ liệu từ bảng **task2** sang **task**
   *       - Không insert trùng (dựa vào id_taskBackups + tb_bak)
   *       - Gán tb_bak = 'task2'
   *       - Không insert cột identity `id`
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
   *                   example: true
   *                 total:
   *                   type: number
   *                   example: 1200
   *                 inserted:
   *                   type: number
   *                   example: 1180
   *                 skipped:
   *                   type: number
   *                   example: 20
   *                 errors:
   *                   type: number
   *                   example: 0
   *                 duration:
   *                   type: string
   *                   example: "12.45"
   */
  migrateTaskRecords = this.asyncHandler(async (req, res) => {
    await this.initService();
    logger.info('API migrate task2 → task');
    const result = await this.service.migrateTaskRecords();
    return this.success(res, result, 'Migration task2 → task thành công');
  });
}

module.exports = new MigrationTask2ToTaskController();

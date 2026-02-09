// controllers/SenderUnitController.js
const BaseController = require('./BaseController');
const SenderUnitUpdaterService = require('../services/SenderUnitUpdaterService');
const OutgoingDocument2Model = require('../models/OutgoingDocument2Model'); // ← sửa tên model cho đúng
const logger = require('../utils/logger');

class SenderUnitController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async init() {
    if (!this.service) {
      const model = new OutgoingDocument2Model(); // ← dùng đúng tên class
      await model.initialize();
      this.service = new SenderUnitUpdaterService(model);
    }
  }


  getSenderUnitStatistics = this.asyncHandler(async (req, res) => {
    await this.init();
    const stats = await this.service.getStatistics();
    return this.success(res, stats, 'Thống kê sender_unit');
  });

  testMapping = this.asyncHandler(async (req, res) => {
    await this.init();
    const { donvi } = req.query;
    if (!donvi) return this.error(res, 'Thiếu query param: donvi', 400);

    const result = await this.service.testMapping(donvi);
    return this.success(res, result, 'Test mapping DonVi → sender_unit');
  });
  /**
   * @swagger
   * /migrate/sender-unit:
   *   get:
   *     summary: Đồng bộ đơn vị gửi từ tên sang mã đơn vị
   *     tags: [Dong bo van ban di]
   */
  updateSenderUnits = this.asyncHandler(async (req, res) => {
    await this.init();
    const result = await this.service.updateAllMissing();
    return this.success(res, result, 'Update sender_unit hoàn tất');
  });
  /**
   * @swagger
   * /migrate/sender-unit/batch/:limit:
   *   get:
   *     summary: Đồng bộ văn bản đi có chia nhiều luồng chạy từ tên đơn vị sang mã đơn vị
   *     tags: [Dong bo van ban di]
   */
  updateSenderUnitsBatch = this.asyncHandler(async (req, res) => {
    await this.init();
    const limit = parseInt(req.params.limit) || 500;
    const result = await this.service.updateBatch(limit);
    return this.success(res, result, `Đã update ${result.updated} record (batch ${limit})`);
  });

  updateSingleSenderUnit = this.asyncHandler(async (req, res) => {
    await this.init();
    const { id } = req.params;
    const result = await this.service.updateById(id);
    if (!result.updated) {
      return this.error(res, result.reason || 'Không update được', 400);
    }
    return this.success(res, result, 'Update 1 record thành công');
  });
}

module.exports = new SenderUnitController();
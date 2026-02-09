const AuditActionCodeService = require('../services/AuditActionCode.service');


class AuditActionCodeController {
    /**
   * @swagger
   * /sync/audit-action-code:
   *   get:
   *     summary: Đồng bộ mã hành động (action_code ) cho audit2
   *     tags: [Dong bo luan chuyen van ban]
   */
  async run(req, res) {
    try {
      const service = new AuditActionCodeService();
      await service.initialize();

      const result = await service.execute();

      return res.json({
        success: true,
        message: 'Update action_code cho audit2 thành công',
        data: result
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Lỗi update action_code audit2',
        error: error.message
      });
    }
  }
}

module.exports = new AuditActionCodeController();

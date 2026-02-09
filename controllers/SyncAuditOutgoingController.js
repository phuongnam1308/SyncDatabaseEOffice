const SyncAuditOutgoingService = require('../services/SyncAuditOutgoingService');


  /**
   * @swagger
   * /sync/audit-outgoing:
   *   get:
   *     summary: Đồng bộ đặc trưng của văn bản đi cho luân chuyển văn bản
   *     tags: [Dong bo luan chuyen van ban]
   */
exports.sync = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '200', 10);
    const result = await SyncAuditOutgoingService.sync(limit);

    res.json({
      success: true,
      message: 'Sync audit outgoing success',
      data: result
    });
  } catch (err) {
    console.error('Sync audit outgoing error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

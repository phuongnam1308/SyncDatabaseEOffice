const MigrateIncomingDocumentsService =
  require('../../services/updates/MigrateIncomingDocumentsService');

const service = new MigrateIncomingDocumentsService();
/**
 * @swagger
 * /migrate/incoming-documents:
 *   get:
 *     summary: Đồng bộ từ bảng trung gian văn bản đến về với bảng văn bản đến chính thức
 *     tags: [Dong bo van ban den]
 */
exports.migrate = async (req, res) => {
  try {
    const result = await service.migrate();
    res.json({
      success: true,
      message: 'Migrate incomming_documents thành công',
      data: result
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      error: err.message
    });
  }
};

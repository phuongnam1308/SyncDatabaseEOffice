const UpdateIncomingBookDocumentIdService =
  require('../../services/updates/UpdateIncomingBookDocumentIdService');

const service = new UpdateIncomingBookDocumentIdService();
/**
 * @swagger
 * /update/incoming-book-document-id:
 *   get:
 *     summary: Cập nhật từ tên sổ văn bản ra được mã sổ văn bản cho văn bản đến ở bảng trung gian
 *     tags: [Dong bo van ban den]
 *     responses:
 *       200:
 *         description: Lấy thống kê thành công
 *       500:
 *         description: Lỗi hệ thống
 */

exports.update = async (req, res) => {
  try {
    const result = await service.update();
    res.json({
      success: true,
      message: 'Update book_document_id thành công',
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

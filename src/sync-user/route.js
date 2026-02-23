
const express = require('express');
const router = express.Router();
const StreamUserMigrationController = require('./migrate/StreamUserMigrationController');

/**
 * @swagger
 * tags:
 *   name: Migration Stream User
 *   description: (MỚI) Các API để di chuyển dữ liệu người dùng (user) theo từng đợt (batch), tối ưu cho lượng dữ liệu lớn.
 */

/**
 * @swagger
 * /user/migrate/stream-user:
 *   post:
 *     summary: Chạy di chuyển dữ liệu người dùng theo từng đợt (stream/batch)
 *     description: |
 *       API này khởi động quá trình di chuyển dữ liệu người dùng từ cơ sở dữ liệu nguồn sang cơ sở dữ liệu đích.
 *       Quá trình này được thực hiện theo từng đợt (batch) để tránh quá tải hệ thống và đảm bảo hiệu suất.
 *       Có thể tùy chỉnh tổng số lượng bản ghi cần lấy và kích thước của mỗi đợt.
 *     tags: [Migration Stream User]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               limit:
 *                 type: number
 *                 description: Giới hạn tổng số bản ghi cần di chuyển. Nếu đặt là 0, sẽ di chuyển tất cả.
 *                 default: 0
 *               batch:
 *                 type: number
 *                 description: Số lượng bản ghi được xử lý trong mỗi đợt (batch).
 *                 default: 100
 *               lastProcessedId:
 *                  type: number
 *                  description: ID của bản ghi cuối cùng đã được xử lý ở lần chạy trước. Quá trình sẽ bắt đầu từ ID kế tiếp.
 *                  default: 0
 *     responses:
 *       200:
 *         description: Quá trình di chuyển đã được bắt đầu thành công.
 *       500:
 *         description: Lỗi máy chủ hoặc có lỗi xảy ra trong quá trình di chuyển.
 */
// Định nghĩa route POST cho việc di chuyển dữ liệu người dùng.
// Khi có request tới endpoint này, hàm `runStreamMigration` trong `StreamUserMigrationController` sẽ được gọi để xử lý.
router.post('/migrate/stream-user', StreamUserMigrationController.runStreamMigration);

/**
 * @swagger
 * /user/migrate/stream-user/status:
 *   get:
 *     summary: Lấy thông tin trạng thái của quá trình di chuyển dữ liệu người dùng
 *     description: API này cho phép theo dõi tiến trình của quá trình di chuyển, bao gồm số lượng bản ghi đã xử lý, tổng số, và trạng thái hiện tại.
 *     tags: [Migration Stream User]
 *     responses:
 *       200:
 *         description: Trả về đối tượng chứa thông tin trạng thái chi tiết của quá trình di chuyển.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalToMigrate:
 *                   type: number
 *                   description: Tổng số bản ghi cần di chuyển.
 *                 migratedCount:
 *                   type: number
 *                   description: Số bản ghi đã di chuyển thành công.
 *                 remainingCount:
 *                   type: number
 *                   description: Số bản ghi còn lại.
 *                 status:
 *                   type: string
 *                   description: Trạng thái hiện tại của quá trình (ví dụ: 'IDLE', 'RUNNING', 'DONE', 'ERROR').
 *                 lastProcessedId:
 *                   type: number
 *                   description: ID của bản ghi cuối cùng đã được xử lý.
 *                 error:
 *                   type: object
 *                   description: Thông tin lỗi nếu có.
 */
// Định nghĩa route GET để lấy trạng thái của quá trình di chuyển.
// Khi có request, hàm `getStatus` trong `StreamUserMigrationController` sẽ được gọi.
router.get('/migrate/stream-user/status', StreamUserMigrationController.getStatus);

/**
 * @swagger
 * /user/migrate/stream-user/sync-departments:
 *   post:
 *     summary: API chạy riêng bước đồng bộ phòng ban
 */
router.post('/migrate/stream-user/sync-departments', StreamUserMigrationController.syncDepartments);

module.exports = router;

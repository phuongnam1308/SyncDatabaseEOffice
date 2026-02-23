
const BaseController = require('../../../controllers/BaseController');
const logger = require('../../../utils/logger');
const StreamUserMigrationService = require('./StreamUserMigrationService');

/**
 * Class StreamUserMigrationController
 *
 * Lớp Controller này đóng vai trò là cầu nối giữa các HTTP request và logic nghiệp vụ
 * để di chuyển dữ liệu người dùng. Nó chịu trách nhiệm nhận yêu cầu, xác thực đầu vào,
 * gọi đến `StreamUserMigrationService` để thực hiện công việc chính, và trả về
 * phản hồi (response) cho client.
 *
 * @swagger
 * tags:
 *   name: Stream User Migration
 *   description: API di chuyển dữ liệu người dùng theo cơ chế Stream (Batch) tối ưu bộ nhớ
 * 
 * @extends BaseController - Kế thừa từ một lớp Controller cơ sở có thể chứa các hàm tiện ích chung.
 */
class StreamUserMigrationController extends BaseController {

  /**
   * Hàm khởi tạo (constructor) của controller.
   * Khi một đối tượng `StreamUserMigrationController` được tạo, nó cũng sẽ khởi tạo
   * một đối tượng `StreamUserMigrationService` để có thể tương tác với logic nghiệp vụ.
   */
  constructor() {
    super(); // Gọi constructor của lớp cha (BaseController)
    this.service = new StreamUserMigrationService();
  }

  /**
   * Phương thức chính để khởi chạy quá trình di chuyển dữ liệu người dùng.
   * Đây là một hàm bất đồng bộ (async) và được bao bọc bởi `this.asyncHandler`
   * (một wrapper có thể có trong `BaseController`) để tự động bắt và xử lý các lỗi (exceptions)
   * xảy ra trong quá trình thực thi.
   *
   * @param {Object} req - Đối tượng request của Express, chứa thông tin về yêu cầu từ client,
   *                       bao gồm `req.body` chứa các tham số như `limit`, `batch`.
   * @param {Object} res - Đối tượng response của Express, được dùng để gửi phản hồi về cho client.
   */
  /**
   * @swagger
   * /migrate/stream-user:
   *   post:
   *     summary: Chạy migration user theo luồng (Stream)
   *     description: Di chuyển dữ liệu từ DB cũ sang mới theo từng batch, tránh quá tải RAM.
   *     tags: [Stream User Migration]
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               limit:
   *                 type: integer
   *                 description: Tổng số bản ghi muốn chạy (0 = chạy hết)
   *                 example: 0
   *               batch:
   *                 type: integer
   *                 description: Số bản ghi xử lý mỗi đợt
   *                 example: 100
   *               lastProcessedId:
   *                 type: integer
   *                 description: Tiếp tục chạy từ sau ID này (Resume)
   *                 example: 0
   *     responses:
   *       200:
   *         description: Migration hoàn tất
   *       500:
   *         description: Lỗi hệ thống
   */
  runStreamMigration = this.asyncHandler(async (req, res) => {
    const startTime = Date.now(); // Ghi lại thời điểm bắt đầu để đo lường hiệu năng.

    // Lấy các tham số từ `req.body`. Nếu không được cung cấp, sử dụng giá trị mặc định.
    // `limit`: tổng số bản ghi cần di chuyển (0 = không giới hạn).
    const limit = parseInt(req.body?.limit || 0, 10);
    // `batch`: số lượng bản ghi xử lý trong một lần lặp (một "đợt").
    const batch = parseInt(req.body?.batch || 100, 10);
    // `lastProcessedId`: ID của bản ghi cuối cùng đã xử lý ở lần chạy trước, để tiếp tục.
    // ID có thể là dạng chuỗi (GUID), vì vậy không dùng parseInt. Giá trị mặc định là '0'.
    const lastProcessedId = req.body?.lastProcessedId || '0';

    // === Xác thực đầu vào (Input Validation) ===
    if (batch <= 0) {
      return this.error(res, 'Kích thước batch phải là một số nguyên dương.', 400);
    }
    if (limit < 0) {
      return this.error(res, 'Giới hạn (limit) không được là số âm.', 400);
    }

    logger.info(`BẮT ĐẦU STREAM MIGRATION USER - Limit: ${limit || 'Tất cả'}, Batch: ${batch}, Bắt đầu sau ID: ${lastProcessedId}`);

    try {
      // Khởi tạo service, có thể bao gồm việc kết nối tới các cơ sở dữ liệu.
      await this.service.initialize();

      // Gọi phương thức `migrate` của service để thực hiện logic di chuyển chính.
      const result = await this.service.migrate({ limit, batch, lastProcessedId });

      // Tính toán tổng thời gian thực thi.
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      // Chuẩn bị đối tượng phản hồi khi thành công.
      const responseData = {
        ...result, // Bao gồm kết quả trả về từ service (ví dụ: số lượng bản ghi đã di chuyển).
        duration: `${duration}s` // Thêm thông tin về thời gian thực thi.
      };

      logger.info(`STREAM MIGRATION USER HOÀN TẤT - Thời gian: ${responseData.duration}`);
      // Gửi phản hồi thành công (HTTP 200) về cho client.
      return this.success(res, responseData, 'Di chuyển dữ liệu người dùng hoàn tất.');

    } catch (error) {
      // Bắt và xử lý bất kỳ lỗi nào xảy ra trong khối `try`.
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.error(`LỖI STREAM MIGRATION USER sau ${duration}s: ${error.message}`, { stack: error.stack });
      // Gửi phản hồi lỗi (HTTP 500) về cho client, kèm theo thông điệp lỗi.
      return this.error(res, 'Quá trình di chuyển dữ liệu người dùng gặp lỗi.', 500, {
        error: error.message,
        duration: `${duration}s`
      });
    }
  });

  /**
   * Phương thức để lấy trạng thái hiện tại của quá trình di chuyển.
   * Giúp người dùng có thể theo dõi tiến trình mà không cần phải đợi quá trình hoàn tất.
   *
   * @param {Object} req - Đối tượng request của Express.
   * @param {Object} res - Đối tượng response của Express.
   */
  /**
   * @swagger
   * /migrate/stream-user/status:
   *   get:
   *     summary: Xem trạng thái dữ liệu User (Cũ vs Mới)
   *     tags: [Stream User Migration]
   *     responses:
   *       200:
   *         description: Trả về số lượng bản ghi ở 2 DB
   */
  getStatus = this.asyncHandler(async (req, res) => {
    try {
      // Khởi tạo service để đảm bảo các kết nối sẵn sàng.
      await this.service.initialize();

      // Gọi phương thức `getStatus` của service để lấy dữ liệu trạng thái.
      const status = await this.service.getStatus();

      // Gửi phản hồi thành công (HTTP 200) về cho client.
      return this.success(res, status, 'Lấy trạng thái thành công.');
    } catch (error) {
      // Xử lý lỗi nếu không thể lấy được trạng thái.
      logger.error('Lỗi khi lấy trạng thái di chuyển dữ liệu:', error);
      return this.error(res, 'Không thể lấy được trạng thái của quá trình di chuyển.', 500, {
        error: error.message
      });
    }
  });

  /**
   * @swagger
   * /user/migrate/stream-user/sync-departments:
   *   post:
   *     summary: Đồng bộ phòng ban từ dữ liệu User (Chạy riêng)
   *     description: API này chạy logic hậu xử lý - tạo Organization Units từ Department của User và cập nhật lại ParentID.
   *     tags: [Migration Stream User]
   *     responses:
   *       200:
   *         description: Đồng bộ thành công
   *       500:
   *         description: Lỗi hệ thống
   */
  syncDepartments = this.asyncHandler(async (req, res) => {
    try {
      // Gọi service để thực hiện đồng bộ
      await this.service.syncDepartments();
      
      return this.success(res, null, 'Đồng bộ phòng ban và cập nhật Parent cho User hoàn tất.');
    } catch (error) {
      logger.error(`Lỗi đồng bộ phòng ban: ${error.message}`, { stack: error.stack });
      return this.error(res, 'Lỗi khi đồng bộ phòng ban.', 500, {
        error: error.message
      });
    }
  });
}

// Xuất ra một instance (thể hiện) của lớp `StreamUserMigrationController`.
// Điều này giúp đảm bảo rằng trong toàn bộ ứng dụng, chỉ có một đối tượng controller
// này được sử dụng (Singleton pattern), giúp quản lý state và service một cách nhất quán.
module.exports = new StreamUserMigrationController();

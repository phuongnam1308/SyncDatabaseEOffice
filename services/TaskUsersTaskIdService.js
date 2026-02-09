// services/TaskUsersTaskIdService.js
const TaskUsersTaskIdModel = require('../models/TaskUsersTaskIdModel');
const { formatNumber } = require('../utils/helpers');
const logger = require('../utils/logger');

class TaskUsersTaskIdService {
  constructor() {
    this.model = new TaskUsersTaskIdModel();
    // Không cần batchSize nữa vì dùng UPDATE JOIN một lần
  }

  async initialize() {
    await this.model.initialize();
    logger.info('TaskUsersTaskIdService khởi tạo xong');
  }

  async performUpdate() {
    const start = Date.now();
    logger.info('=== BẮT ĐẦU GÁN task_id vào task_users2 (UPDATE JOIN một lần) ===');

    try {
      const query = `
        UPDATE u
        SET 
          u.task_id = t.id,
          u.update_at = GETDATE()  -- cập nhật thời gian sửa đổi (tùy chọn, có thể bỏ nếu không cần)
        FROM ${this.model.schema}.${this.model.usersTable} u
        INNER JOIN ${this.model.schema}.${this.model.taskTable} t
          ON u.id_task_bak = t.id_taskBackups
        WHERE u.task_id IS NULL
          AND u.id_task_bak IS NOT NULL
          AND t.id_taskBackups IS NOT NULL
      `;

      const request = this.model.newPool.request();
      const result = await request.query(query);

      const updatedRows = result.rowsAffected[0] || 0;
      const duration = ((Date.now() - start) / 1000).toFixed(2);

      logger.info(`Hoàn thành UPDATE JOIN | Updated: ${formatNumber(updatedRows)} dòng | Thời gian: ${duration}s`);

      return {
        success: true,
        updatedRows: updatedRows,
        errors: 0,
        durationSeconds: duration,
        message: updatedRows > 0 
          ? `Đã gán task_id cho ${formatNumber(updatedRows)} dòng thành công`
          : 'Không có dòng nào cần update (hoặc đã update hết trước đó)'
      };
    } catch (err) {
      logger.error('Lỗi khi chạy UPDATE JOIN gán task_id:', err);
      throw err;
    }
  }

  async getStatistics() {
    return await this.model.getStatistics();
  }
}

module.exports = TaskUsersTaskIdService;
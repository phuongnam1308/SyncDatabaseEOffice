// services/MigrationBookTotalStatisticsService.js
const sql = require('mssql');
const { oldDbConfig, newDbConfig } = require('../config/database');
const logger = require('../utils/logger');

class MigrationBookTotalStatisticsService {
  async getTotalStatistics() {
    let oldPool = null;
    let newPool = null;

    try {
      // Kết nối DB cũ
      oldPool = new sql.ConnectionPool(oldDbConfig);
      await oldPool.connect();

      // Kết nối DB mới
      newPool = new sql.ConnectionPool(newDbConfig);
      await newPool.connect();

      // 1. Đếm old từ 4 bảng cũ (dùng oldPool)
      const oldQueries = [
        "SELECT COUNT(*) as count FROM dbo.VanBanDen",
        "SELECT COUNT(*) as count FROM dbo.VanBanDenDelete",
        "SELECT COUNT(*) as count FROM dbo.VanBanBanHanh",
        "SELECT COUNT(*) as count FROM dbo.VanBanBanHanhDelete"
      ];

      const oldCounts = await Promise.all(
        oldQueries.map(q => oldPool.request().query(q).then(r => r.recordset[0].count))
      );

      // 2. Đếm new từ book_documents (dùng newPool)
      const newTotal = await newPool.request().query(`
        SELECT COUNT(*) as total FROM dbo.book_documents
      `).then(r => r.recordset[0].total);

      const newByType = await newPool.request().query(`
        SELECT type_document, COUNT(*) as count
        FROM dbo.book_documents
        GROUP BY type_document
      `).then(r => r.recordset);

      return {
        old: {
          VanBanDen: oldCounts[0],
          VanBanDenDelete: oldCounts[1],
          VanBanBanHanh: oldCounts[2],
          VanBanBanHanhDelete: oldCounts[3],
          total_old: oldCounts.reduce((a, b) => a + b, 0)
        },
        new: {
          total_books: newTotal,
          by_type: newByType
        },
        summary: {
          migrated_percentage: oldCounts.reduce((a, b) => a + b, 0) > 0 
            ? ((newTotal / oldCounts.reduce((a, b) => a + b, 0)) * 100).toFixed(2) + '%'
            : '0%'
        }
      };
    } catch (error) {
      logger.error('Lỗi lấy thống kê tổng quát 4 nguồn:', error);
      throw error;
    } finally {
      if (oldPool) await oldPool.close().catch(() => {});
      if (newPool) await newPool.close().catch(() => {});
    }
  }
}

module.exports = MigrationBookTotalStatisticsService;
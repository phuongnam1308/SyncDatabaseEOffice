// services/FormatOutgoing2Service.js
const OutgoingDocument2Model = require('../models/OutgoingDocument2Model');
const logger = require('../utils/logger');
const { formatNumber } = require('../utils/helpers');

class FormatOutgoing2Service {
  constructor() {
    this.model = new OutgoingDocument2Model();
  }

  async initialize() {
    await this.model.initialize();
    logger.info('FormatOutgoing2Service đã khởi tạo');
  }

  async runFormat() {
    const startTime = Date.now();
    logger.info('=== BẮT ĐẦU FORMAT / CLEAN outgoing_documents2 ===');

    let totalAffected = 0;
    const reports = [];

    try {
      // 1. Clean private_level (độ mật)
      const privateQueries = [
        // Chuẩn hóa về mã ngắn
        `UPDATE camunda.dbo.outgoing_documents2
         SET private_level = 'thng'
         WHERE private_level IN (N'Thường', N'Thu?ng', N'Thư?ng', N'thng', '', '11', NULL)`,

        `UPDATE camunda.dbo.outgoing_documents2
         SET private_level = 'mt'
         WHERE private_level IN (N'Mật', N'M?t', N'mt')`,

        `UPDATE camunda.dbo.outgoing_documents2
         SET private_level = 'ti-mt'
         WHERE private_level IN (N'Tối mật', N'T?i m?t', N'ti-mt')`,

        `UPDATE camunda.dbo.outgoing_documents2
         SET private_level = 'tuyt-mt'
         WHERE private_level IN (N'Tuyệt mật', N'Tuy?t m?t', N'tuyt-mt')`,

        `UPDATE camunda.dbo.outgoing_documents2
         SET private_level = 'hn-ch-truy-cp'
         WHERE private_level IN (N'Hạn chế truy cập', N'H?n ch? truy c?p', N'khn')`,
      ];

      for (const q of privateQueries) {
        const r = await this.model.queryNewDb(q);
        const affected = r.rowsAffected?.[0] || 0;
        totalAffected += affected;
        reports.push({ step: 'private_level', affected });
      }

      // 2. Clean urgency_level (độ khẩn)
      const urgencyQueries = [
        `UPDATE camunda.dbo.outgoing_documents2
         SET urgency_level = 'khn'
         WHERE urgency_level IN (N'Khẩn', N'KHẨN', N'Kh?n', N'khn')`,

        `UPDATE camunda.dbo.outgoing_documents2
         SET urgency_level = 'thng'
         WHERE urgency_level IN (N'Thường', N'THƯỜNG', N'Thu?ng', N'Thư?ng', '', NULL)`,
      ];

      for (const q of urgencyQueries) {
        const r = await this.model.queryNewDb(q);
        const affected = r.rowsAffected?.[0] || 0;
        totalAffected += affected;
        reports.push({ step: 'urgency_level', affected });
      }

      // 3. Clean document_type (loại văn bản) - chỉ xử lý một số trường hợp phổ biến còn sót
      const docTypeQueries = [
        // Một số fix bổ sung nếu migration chưa xử lý hết
        `UPDATE camunda.dbo.outgoing_documents2
         SET document_type = '55;#Cong van'
         WHERE document_type LIKE N'%Cong van%' OR document_type LIKE N'%công văn%'`,

        `UPDATE camunda.dbo.outgoing_documents2
         SET document_type = TRIM(REPLACE(document_type, N'# ', N'#'))  -- loại bỏ khoảng trắng thừa`,
      ];

      for (const q of docTypeQueries) {
        const r = await this.model.queryNewDb(q);
        const affected = r.rowsAffected?.[0] || 0;
        totalAffected += affected;
        reports.push({ step: 'document_type', affected });
      }

      // 4. Map status_code từ TrangThai (nếu cần khôi phục logic cũ)
      const statusQuery = `
        UPDATE camunda.dbo.outgoing_documents2
        SET status_code = 
            CASE TRIM(TrangThai)
                WHEN N'Chờ phát hành' THEN '6'
                WHEN N'Phát hành'     THEN '7'
                WHEN N'Báo cáo'       THEN '100'
                WHEN N'Lưu'           THEN '100'
                WHEN N'Thu hồi'       THEN '100'
                WHEN N'Hủy'           THEN '100'
                WHEN N'Đã phát hành'  THEN '7'
                ELSE '1'
            END
        WHERE status_code = '100' OR status_code IS NULL
      `;
      const statusResult = await this.model.queryNewDb(statusQuery);
      const statusAffected = statusResult.rowsAffected?.[0] || 0;
      totalAffected += statusAffected;
      reports.push({ step: 'status_code', affected: statusAffected });

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info(`=== HOÀN THÀNH FORMAT outgoing_documents2 ===`);
      logger.info(`Thời gian: ${duration}s | Tổng dòng ảnh hưởng: ${formatNumber(totalAffected)}`);

      return {
        success: true,
        totalAffected,
        duration,
        reports,
      };
    } catch (error) {
      logger.error('Lỗi trong quá trình format outgoing_documents2:', error);
      throw error;
    }
  }

  async getCurrentStatistics() {
    try {
      const privateStats = await this.model.queryNewDb(`
        SELECT private_level, COUNT(*) AS count
        FROM camunda.dbo.outgoing_documents2
        GROUP BY private_level
        ORDER BY count DESC
      `);

      const urgencyStats = await this.model.queryNewDb(`
        SELECT urgency_level, COUNT(*) AS count
        FROM camunda.dbo.outgoing_documents2
        GROUP BY urgency_level
        ORDER BY count DESC
      `);

      const statusStats = await this.model.queryNewDb(`
        SELECT status_code, COUNT(*) AS count
        FROM camunda.dbo.outgoing_documents2
        GROUP BY status_code
        ORDER BY count DESC
      `);

      return {
        private_level: privateStats.recordset,
        urgency_level: urgencyStats.recordset,
        status_code: statusStats.recordset,
      };
    } catch (error) {
      logger.error('Lỗi lấy thống kê format:', error);
      throw error;
    }
  }

  async close() {
    await this.model.close();
  }
}

module.exports = FormatOutgoing2Service;
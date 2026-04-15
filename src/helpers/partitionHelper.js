const logger = require('../../utils/logger');

const DEFAULT_START_YEAR = 2012;
const DEFAULT_END_YEAR = 2026;

/**
 * Utility to handle synchronization partitioning logic.
 */
class PartitionHelper {
  constructor() {
    this.partitionId = process.env.SYNC_PARTITION ? parseInt(process.env.SYNC_PARTITION, 10) : null;
    this.fromDate = process.env.SYNC_FROM_DATE || null;
    this.toDate = process.env.SYNC_TO_DATE || null;

    logger.info(`[PartitionHelper] Initializing: SYNC_PARTITION=${this.partitionId}, fromDate=${this.fromDate}, toDate=${this.toDate}`);

    // Nếu có partitionId và chưa có from/to date -> Tự động tính toán
    if (this.partitionId && (!this.fromDate || !this.toDate)) {
      this.calculatePartitionDates();
    }
  }

  /**
   * Tính toán ngày bắt đầu và kết thúc dựa trên partitionId (1, 2, 3)
   * P1: 2012 - 2016
   * P2: 2017 - 2021
   * P3: 2022 - 2026
   */
  calculatePartitionDates() {
    switch (this.partitionId) {
      case 1:
        this.fromDate = '2012-01-01T00:00:00.000Z';
        this.toDate = '2016-12-31T23:59:59.999Z';
        break;
      case 2:
        this.fromDate = '2017-01-01T00:00:00.000Z';
        this.toDate = '2021-12-31T23:59:59.999Z';
        break;
      case 3:
        this.fromDate = '2022-01-01T00:00:00.000Z';
        this.toDate = '2026-12-31T23:59:59.999Z';
        break;
      default:
        logger.warn(`[PartitionHelper] Invalid SYNC_PARTITION: ${this.partitionId}. Partition logic skipped.`);
    }

    if (this.fromDate && this.toDate) {
      logger.info(`[PartitionHelper] Partition ${this.partitionId} range: ${this.fromDate} to ${this.toDate}`);
    }
  }

  /**
   * Trả về nhãn hậu tố cho Model (ví dụ: " - P1")
   */
  getLabelSuffix() {
    if (this.partitionId) {
      return ` - P${this.partitionId}`;
    }
    return '';
  }

  /**
   * Trả về cấu hình filter cho SQL
   */
  getSqlFilter() {
    return {
      fromDate: this.fromDate,
      toDate: this.toDate
    };
  }

  /**
   * Kiểm tra xem phân đoạn có đang được kích hoạt không
   */
  isEnabled() {
    return (this.fromDate && this.toDate);
  }
}

module.exports = new PartitionHelper();

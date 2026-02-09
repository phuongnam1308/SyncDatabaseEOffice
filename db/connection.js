const sql = require('mssql');
const { oldDbConfig, newDbConfig } = require('../config/database');
const logger = require('../utils/logger');

class DatabaseConnection {
  constructor() {
    this.oldPool = null;
    this.newPool = null;
  }

  // Kết nối đến database cũ
  async connectOldDb() {
    try {
      if (this.oldPool && this.oldPool.connected) {
        return this.oldPool;
      }

      logger.info('Đang kết nối đến database cũ...');
      this.oldPool = await sql.connect(oldDbConfig);
      logger.info('Kết nối database cũ thành công!');
      return this.oldPool;
    } catch (error) {
      logger.error('Lỗi kết nối database cũ:', error);
      throw error;
    }
  }

  // Kết nối đến database mới
  async connectNewDb() {
    try {
      if (this.newPool && this.newPool.connected) {
        return this.newPool;
      }

      logger.info('Đang kết nối đến database mới...');
      this.newPool = await new sql.ConnectionPool(newDbConfig).connect();
      logger.info('Kết nối database mới thành công!');
      return this.newPool;
    } catch (error) {
      logger.error('Lỗi kết nối database mới:', error);
      throw error;
    }
  }

  // Kết nối cả 2 database
  async connectAll() {
    try {
      await this.connectOldDb();
      await this.connectNewDb();
      logger.info('Kết nối tất cả database thành công!');
    } catch (error) {
      logger.error('Lỗi kết nối database:', error);
      throw error;
    }
  }

  // Đóng kết nối database cũ
  async closeOldDb() {
    try {
      if (this.oldPool) {
        await this.oldPool.close();
        this.oldPool = null;
        logger.info('Đã đóng kết nối database cũ');
      }
    } catch (error) {
      logger.error('Lỗi đóng kết nối database cũ:', error);
    }
  }

  // Đóng kết nối database mới
  async closeNewDb() {
    try {
      if (this.newPool) {
        await this.newPool.close();
        this.newPool = null;
        logger.info('Đã đóng kết nối database mới');
      }
    } catch (error) {
      logger.error('Lỗi đóng kết nối database mới:', error);
    }
  }

  // Đóng tất cả kết nối
  async closeAll() {
    await this.closeOldDb();
    await this.closeNewDb();
    logger.info('Đã đóng tất cả kết nối database');
  }

  // Lấy pool connection cũ
  getOldPool() {
    return this.oldPool;
  }

  // Lấy pool connection mới
  getNewPool() {
    return this.newPool;
  }
}

module.exports = new DatabaseConnection();
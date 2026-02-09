const mssql = require('mssql');
const logger = require('./logger');
const { newDbConfig } = require('../config/database');

let newPool;

async function getNewPool() {
  if (!newPool) {
    try {
      newPool = await mssql.connect(newDbConfig);
      logger.info('✅ Global NEW DB pool initialized');
    } catch (err) {
      console.log('getNewPool: ', err);
      logger.error('❌ Failed to create NEW DB pool', err);
      throw err;
    }
  }
  return newPool;
}

async function closeNewPool() {
  if (newPool) {
    await newPool.close();
    newPool = null;
    logger.info('🔌 NEW DB pool closed');
  }
}

module.exports = {
  getNewPool,
  closeNewPool
};

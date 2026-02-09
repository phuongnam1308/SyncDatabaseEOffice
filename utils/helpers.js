const logger = require('./logger');

/**
 * Chuyển đổi giá trị null/undefined thành null
 */
const sanitizeValue = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return value;
};

/**
 * Chuyển đổi dữ liệu từ bảng cũ sang bảng mới theo mapping
 */
const mapFieldValues = (oldRecord, fieldMapping, defaultValues) => {
  const newRecord = {};

  // Áp dụng field mapping
  for (const [oldField, newField] of Object.entries(fieldMapping)) {
    newRecord[newField] = sanitizeValue(oldRecord[oldField]);
  }

  // Áp dụng default values
  for (const [field, value] of Object.entries(defaultValues)) {
    if (!(field in newRecord)) {
      newRecord[field] = typeof value === 'function' ? value() : value;
    }
  }

  return newRecord;
};

/**
 * Tạo câu INSERT SQL
 */
const buildInsertQuery = (tableName, schema, fields) => {
  const columns = Object.keys(fields).join(', ');
  const values = Object.keys(fields).map((_, index) => `@param${index}`).join(', ');
  
  return `INSERT INTO ${schema}.${tableName} (${columns}) VALUES (${values})`;
};

/**
 * Tạo câu UPDATE SQL
 */
const buildUpdateQuery = (tableName, schema, fields, whereCondition) => {
  const setClause = Object.keys(fields)
    .map((field, index) => `${field} = @param${index}`)
    .join(', ');
  
  return `UPDATE ${schema}.${tableName} SET ${setClause} WHERE ${whereCondition}`;
};

/**
 * Kiểm tra ID đã tồn tại chưa
 */
const checkIdExists = async (pool, tableName, schema, id) => {
  try {
    const query = `SELECT COUNT(*) as count FROM ${schema}.${tableName} WHERE id = @id`;
    const result = await pool.request()
      .input('id', id)
      .query(query);
    
    return result.recordset[0].count > 0;
  } catch (error) {
    logger.error(`Lỗi kiểm tra ID tồn tại: ${error.message}`);
    throw error;
  }
};

/**
 * Chia mảng thành các batch nhỏ
 */
const chunkArray = (array, size) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

/**
 * Format số với dấu phẩy
 */
const formatNumber = (num) => {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

/**
 * Tính phần trăm
 */
const calculatePercentage = (current, total) => {
  if (total === 0) return 0;
  return ((current / total) * 100).toFixed(2);
};

/**
 * Sleep function
 */
const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Retry function
 */
const retry = async (fn, maxRetries = 3, delay = 1000) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      logger.warn(`Thử lại lần ${i + 1}/${maxRetries} sau ${delay}ms...`);
      await sleep(delay);
    }
  }
};

module.exports = {
  sanitizeValue,
  mapFieldValues,
  buildInsertQuery,
  buildUpdateQuery,
  checkIdExists,
  chunkArray,
  formatNumber,
  calculatePercentage,
  sleep,
  retry
};
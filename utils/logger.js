const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Tạo thư mục logs nếu chưa tồn tại (AN TOÀN)
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
  } catch (err) {
    console.error('[LOGGER] Cannot create logs directory:', err.message);
  }
}

// Định dạng log
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    if (stack) {
      return `${timestamp} [${level.toUpperCase()}]: ${message}\n${stack}`;
    }
    return `${timestamp} [${level.toUpperCase()}]: ${message}`;
  })
);

// Tạo logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880,
      maxFiles: 5
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880,
      maxFiles: 5
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'migration.log'),
      maxsize: 5242880,
      maxFiles: 5
    })
  ]
});

// Dev / non-prod thì log ra console
if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  );
}

/**
 * Bắt đầu đo thời gian cho một tác vụ.
 * Trả về object có hàm .stop() để kết thúc và log kết quả.
 * @param {string} label Nhãn của tác vụ
 * @param {object} metadata Metadata bổ sung
 */
logger.startTimer = function(label, metadata = {}) {
  const start = process.hrtime();
  return {
    stop: (recordCount = null) => {
      const end = process.hrtime(start);
      const durationMs = (end[0] * 1000 + end[1] / 1000000).toFixed(2);
      
      let msg = `[PERF] ${label} took ${durationMs}ms`;
      if (recordCount !== null && recordCount > 0) {
        const msPerRow = (durationMs / recordCount).toFixed(2);
        msg += ` for ${recordCount} rows (${msPerRow}ms/row)`;
      }

      // Tự động đánh dấu nếu thấy chậm (> 500ms hoặc tùy ý)
      if (parseFloat(durationMs) > 500) {
        logger.warn(`${msg} [SLOW DETECTED]`);
      } else {
        logger.info(msg, { ...metadata, durationMs, recordCount });
      }
      return durationMs;
    }
  };
};

module.exports = logger;

/**
 * Logger tối giản dùng cho toàn hệ thống
 * Không dùng winston / bunyan
 * Chỉ wrap console cho khỏi lỗi require
 */

function format(level, args) {
  const time = new Date().toISOString();
  return [`[${time}]`, `[${level}]`, ...args];
}

module.exports = {
  info: (...args) => {
    console.log(...format('INFO', args));
  },

  warn: (...args) => {
    console.warn(...format('WARN', args));
  },

  error: (...args) => {
    console.error(...format('ERROR', args));
  },

  debug: (...args) => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(...format('DEBUG', args));
    }
  }
};

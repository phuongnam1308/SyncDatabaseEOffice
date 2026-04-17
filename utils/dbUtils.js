const sql = require('mssql');

/**
 * Bọc transaction với retry tự động khi bị SQL Server deadlock (Error 1205)
 * Exponential backoff + full jitter
 */
async function withTransactionRetry(pool, workFn, options = {}) {
  const maxRetries = options.maxRetries ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 50;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const transaction = pool.transaction();

    try {
      await transaction.begin();
      const result = await workFn(transaction);
      await transaction.commit();
      return result;
    } catch (err) {
      if (transaction._acquiredConnection) {
        await transaction.rollback().catch(() => {});
      }

      const isDeadlock =
        err.number === 1205 ||
        (err.code === 'EREQUEST' && err.number === 1205) ||
        (err.originalError && err.originalError.number === 1205);

      if (isDeadlock && attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 100;
        console.warn(
          `[Deadlock] Đang retry transaction (lần ${attempt + 1}/${maxRetries + 1}) ` +
          `sau ${Math.round(delay)}ms. Lỗi: ${err.message}`
        );
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      if (isDeadlock) {
        console.error(`[Deadlock] Đã retry đủ ${maxRetries} lần. Bỏ qua.`);
      }
      throw err;
    }
  }
}

module.exports = {
  // giữ nguyên các export cũ (hiện tại file trống)
  withTransactionRetry,
};

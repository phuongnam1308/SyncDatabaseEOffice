const sql = require('mssql');

/**
 * Determines whether an error is a retryable SQL Server transient fault.
 * Covers:
 *   - Error 1205  (deadlock)
 *   - Error 3930  ("transaction is in abort state" / doomed transaction)
 *   - Message containing "Transaction has been aborted" (comes from READPAST /
 *     lock-wait timeout after the transaction was already doomed by a prior
 *     deadlock that was swallowed inside the same connection session)
 */
function isRetryableSqlError(err) {
  if (!err) return false;
  const num = err.number ?? err.originalError?.number ?? 0;
  const msg = err.message || '';
  const code = err.code || '';
  return (
    num === 1205 ||
    num === 3930 ||
    code === 'EREQUEST' && num === 1205 ||
    code === 'EREQUEST' && num === 3930 ||
    msg.includes('Transaction has been aborted') ||
    msg.includes('Transaction context in use by other sessions') ||
    msg.includes('Could not continue processing')
  );
}

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

      const isDeadlock = isRetryableSqlError(err);

      if (isDeadlock && attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 100;
        console.warn(
          `[Deadlock/Doomed] Đang retry transaction (lần ${attempt + 1}/${maxRetries + 1}) ` +
          `sau ${Math.round(delay)}ms. Lỗi: ${err.message}`
        );
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      if (isDeadlock) {
        console.error(`[Deadlock/Doomed] Đã retry đủ ${maxRetries} lần. Bỏ qua.`);
      }
      throw err;
    }
  }
}

module.exports = {
  withTransactionRetry,
  isRetryableSqlError,
};

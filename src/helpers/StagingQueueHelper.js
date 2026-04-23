const logger = require('../../utils/logger');

const DEFAULT_STALE_MINUTES = Number(process.env.STALE_PROCESSING_TIMEOUT_MINUTES || 30);
const DEFAULT_HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS || 30000);
const DEFAULT_ERROR_MAX_LENGTH = Number(process.env.STAGING_ERROR_MAX_LENGTH || 4000);

function getInfoSchemaRef(dbName) {
  return dbName ? `${dbName}.INFORMATION_SCHEMA.COLUMNS` : 'INFORMATION_SCHEMA.COLUMNS';
}

function trimErrorMessage(errorMessage, maxLength = DEFAULT_ERROR_MAX_LENGTH) {
  return String(errorMessage || 'Unknown processing error').slice(0, maxLength);
}

function toLogLabel(model, label) {
  return label || model?.modelName || 'STAGING_QUEUE';
}

function formatRowToken(row, rowLabel) {
  const value = row?.SY_SyncId ?? row?.ID ?? row?.DocId ?? row?.seq_id ?? row?.code ?? 'N/A';
  return `${rowLabel || 'row'}=${value}`;
}

async function runNewDb(model, query, params = {}, transaction = null) {
  if (transaction) {
    return model.queryNewDbTx(query, params, transaction);
  }
  return model.queryNewDb(query, params);
}

async function ensureTrackingColumns(model, options = {}) {
  const {
    tableRef,
    tableName,
    schemaName = 'dbo',
    dbName = null,
    extraColumns = [],
    label,
  } = options;

  const columns = [
    { name: 'MigrateFlg', type: 'INT' },
    { name: 'MigrateErrFlg', type: 'INT' },
    { name: 'MigrateErrMess', type: 'NVARCHAR(MAX)' },
    { name: 'processing_owner', type: 'NVARCHAR(255)' },
    { name: 'processing_started_at', type: 'DATETIME2' },
    { name: 'processing_heartbeat_at', type: 'DATETIME2' },
    { name: '__sync_time', type: 'DATETIME2' },
    { name: '__sync_id', type: 'BIGINT' },
    ...extraColumns,
  ];

  for (const column of columns) {
    await model.queryNewDb(`
      IF NOT EXISTS (
        SELECT 1
        FROM ${getInfoSchemaRef(dbName)}
        WHERE TABLE_SCHEMA = '${schemaName}'
          AND TABLE_NAME = '${tableName}'
          AND COLUMN_NAME = '${column.name}'
      )
      BEGIN
        ALTER TABLE ${tableRef} ADD [${column.name}] ${column.type} NULL;
      END
    `);
  }

  logger.info(`[${toLogLabel(model, label)}] Tracking columns ensured for ${tableRef}`);
}

async function claimNextStagingRow(model, options = {}) {
  const {
    tableRef,
    orderBy,
    extraWhere = '',
    params = {},
    owner,
    label,
    transaction = null,
    rowLabel = 'ID',
    extraSet = [],
  } = options;

  const whereClause = extraWhere ? `\n          AND (${extraWhere})` : '';
  const extraSetClause = extraSet.length ? `,\n            ${extraSet.join(',\n            ')}` : '';

  const rows = await runNewDb(
    model,
    `
      ;WITH CTE AS (
        SELECT TOP (1) *
        FROM ${tableRef} WITH (READPAST, UPDLOCK, ROWLOCK)
        WHERE ISNULL(MigrateFlg, 0) = 0${whereClause}
        ORDER BY ${orderBy}
      )
      UPDATE CTE
      SET MigrateFlg = 2,
          MigrateErrMess = N'Processing...',
          processing_owner = @owner,
          processing_started_at = SYSUTCDATETIME(),
          processing_heartbeat_at = SYSUTCDATETIME()${extraSetClause}
      OUTPUT inserted.*
    `,
    { ...params, owner },
    transaction,
  );

  const row = rows?.[0] || null;
  if (row) {
    logger.info(
      `[${toLogLabel(model, label)}] [CLAIM] Row claimed: ${formatRowToken(row, rowLabel)}, owner=${owner}`,
    );
  }
  return row;
}

async function updateHeartbeat(model, options = {}) {
  const {
    tableRef,
    keyWhere,
    params = {},
    label,
    transaction = null,
    rowToken = null,
    extraSet = [],
  } = options;

  const extraSetClause = extraSet.length ? `,\n          ${extraSet.join(',\n          ')}` : '';
  const rows = await runNewDb(
    model,
    `
      UPDATE ${tableRef} WITH (ROWLOCK)
      SET processing_heartbeat_at = SYSUTCDATETIME()${extraSetClause}
      WHERE ${keyWhere}
        AND MigrateFlg = 2;

      SELECT @@ROWCOUNT AS affected;
    `,
    params,
    transaction,
  );

  const affected = Number(rows?.[0]?.affected || 0);
  if (affected > 0) {
    logger.info(`[${toLogLabel(model, label)}] [HEARTBEAT] Updated: ${rowToken || 'row'}`);
  }
  return affected;
}

async function markRowSuccess(model, options = {}) {
  const {
    tableRef,
    keyWhere,
    params = {},
    label,
    transaction = null,
    rowToken = null,
    extraSet = [],
  } = options;

  const extraSetClause = extraSet.length ? `,\n          ${extraSet.join(',\n          ')}` : '';
  const rows = await runNewDb(
    model,
    `
      UPDATE ${tableRef} WITH (ROWLOCK)
      SET MigrateFlg = 1,
          MigrateErrFlg = 0,
          MigrateErrMess = NULL,
          processing_owner = NULL,
          processing_started_at = NULL,
          processing_heartbeat_at = NULL${extraSetClause}
      WHERE ${keyWhere};

      SELECT @@ROWCOUNT AS affected;
    `,
    params,
    transaction,
  );

  const affected = Number(rows?.[0]?.affected || 0);
  if (affected > 0) {
    logger.info(`[${toLogLabel(model, label)}] [SUCCESS] Row processed successfully: ${rowToken || 'row'}`);
    logger.info(`[${toLogLabel(model, label)}] [RELEASE] Lock released: ${rowToken || 'row'}`);
  }
  return affected;
}

async function markRowFailed(model, options = {}) {
  const {
    tableRef,
    keyWhere,
    params = {},
    label,
    transaction = null,
    rowToken = null,
    errorMessage,
    extraSet = [],
  } = options;

  const errMsg = trimErrorMessage(errorMessage);
  const extraSetClause = extraSet.length ? `,\n          ${extraSet.join(',\n          ')}` : '';
  const rows = await runNewDb(
    model,
    `
      UPDATE ${tableRef} WITH (ROWLOCK)
      SET MigrateFlg = 3,
          MigrateErrFlg = 1,
          MigrateErrMess = @errorMessage,
          processing_owner = NULL,
          processing_started_at = NULL,
          processing_heartbeat_at = NULL${extraSetClause}
      WHERE ${keyWhere};

      SELECT @@ROWCOUNT AS affected;
    `,
    { ...params, errorMessage: errMsg },
    transaction,
  );

  const affected = Number(rows?.[0]?.affected || 0);
  if (affected > 0) {
    logger.error(`[${toLogLabel(model, label)}] [ERROR] Processing failed: ${rowToken || 'row'} | ${errMsg}`);
    logger.info(`[${toLogLabel(model, label)}] [RELEASE] Lock released: ${rowToken || 'row'}`);
  }
  return affected;
}

async function releaseStaleClaims(model, options = {}) {
  const {
    tableRef,
    extraWhere = '',
    params = {},
    label,
    staleMinutes = DEFAULT_STALE_MINUTES,
    releaseMessage = 'Heartbeat timeout - lock released for retry',
    extraSet = [],
  } = options;

  const whereClause = extraWhere ? `\n        AND (${extraWhere})` : '';
  const extraSetClause = extraSet.length ? `,\n          ${extraSet.join(',\n          ')}` : '';
  const rows = await model.queryNewDb(
    `
      UPDATE ${tableRef} WITH (ROWLOCK)
      SET MigrateFlg = 0,
          MigrateErrFlg = 0,
          MigrateErrMess = @releaseMessage,
          processing_owner = NULL,
          processing_started_at = NULL,
          processing_heartbeat_at = NULL${extraSetClause}
      WHERE MigrateFlg = 2
        AND DATEDIFF(
          MINUTE,
          ISNULL(processing_heartbeat_at, processing_started_at),
          SYSUTCDATETIME()
        ) >= @staleMinutes${whereClause};

      SELECT @@ROWCOUNT AS affected;
    `,
    {
      ...params,
      releaseMessage,
      staleMinutes,
    },
  );

  const affected = Number(rows?.[0]?.affected || 0);
  if (affected > 0) {
    logger.info(
      `[${toLogLabel(model, label)}] [RELEASE] Lock released for stale rows: count=${affected}, staleMinutes=${staleMinutes}`,
    );
  }
  return affected;
}

function startHeartbeatLoop(updateFn, intervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS) {
  if (!intervalMs || intervalMs <= 0) {
    return () => {};
  }

  const timer = setInterval(() => {
    Promise.resolve(updateFn()).catch(() => {});
  }, intervalMs);

  return () => clearInterval(timer);
}

module.exports = {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_STALE_MINUTES,
  claimNextStagingRow,
  ensureTrackingColumns,
  markRowFailed,
  markRowSuccess,
  releaseStaleClaims,
  startHeartbeatLoop,
  trimErrorMessage,
  updateHeartbeat,
};

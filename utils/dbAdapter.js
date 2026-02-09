const rawDb = require('../config/database');

async function query(sqlText) {
  // case 1: export trực tiếp poolPromise
  if (rawDb && typeof rawDb.then === 'function') {
    const pool = await rawDb;
    return pool.request().query(sqlText);
  }

  // case 2: { poolPromise }
  if (rawDb && rawDb.poolPromise && typeof rawDb.poolPromise.then === 'function') {
    const pool = await rawDb.poolPromise;
    return pool.request().query(sqlText);
  }

  // case 3: { sql, poolPromise }
  if (
    rawDb &&
    rawDb.sql &&
    rawDb.poolPromise &&
    typeof rawDb.poolPromise.then === 'function'
  ) {
    const pool = await rawDb.poolPromise;
    return pool.request().query(sqlText);
  }

  throw new Error(
    '[dbAdapter] Không nhận diện được database export (poolPromise)'
  );
}

module.exports = { query };

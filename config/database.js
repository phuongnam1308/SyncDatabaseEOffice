require('dotenv').config();

function requiredEnv(name) {
  if (!process.env[name]) {
    throw new Error(`❌ Missing environment variable: ${name}`);
  }
  return process.env[name];
}

console.log('=== ENV CHECK ===');
console.log({
  OLD_DB_SERVER: process.env.OLD_DB_SERVER,
  OLD_DB_PORT: process.env.OLD_DB_PORT,
  OLD_DB_NAME: process.env.OLD_DB_NAME,
  OLD_DB_USER: process.env.OLD_DB_USER,
  OLD_DB_PASSWORD_LENGTH: process.env.OLD_DB_PASSWORD
    ? process.env.OLD_DB_PASSWORD.length
    : null,

  NEW_DB_SERVER: process.env.NEW_DB_SERVER,
  NEW_DB_PORT: process.env.NEW_DB_PORT,
  NEW_DB_NAME: process.env.NEW_DB_NAME,
  NEW_DB_USER: process.env.NEW_DB_USER,
  NEW_DB_PASSWORD: process.env.NEW_DB_PASSWORD,
  NEW_DB_PASSWORD_LENGTH: process.env.NEW_DB_PASSWORD
    ? process.env.NEW_DB_PASSWORD.length
    : null
});
console.log('=================');

const oldDbConfig = {
  server: requiredEnv('OLD_DB_SERVER'),
  port: parseInt(process.env.OLD_DB_PORT || '1433'),
  database: requiredEnv('OLD_DB_NAME'),
  user: requiredEnv('OLD_DB_USER'),
  password: requiredEnv('OLD_DB_PASSWORD'),
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
    connectionTimeout: 30000,
    requestTimeout: 30000
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

const newDbConfig = {
  server: requiredEnv('NEW_DB_SERVER'),
  port: parseInt(process.env.NEW_DB_PORT || '1433'),
  database: requiredEnv('NEW_DB_NAME'),
  user: requiredEnv('NEW_DB_USER'),
  password: requiredEnv('NEW_DB_PASSWORD'),
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
    connectionTimeout: 30000,
    requestTimeout: 30000
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

module.exports = {
  oldDbConfig,
  newDbConfig,
  async query(sql, params = {}) {
    const pool = await poolPromise;
    const request = pool.request();
    for (const key in params) {
      request.input(key, params[key]);
    }
    const result = await request.query(sql);
    return result.recordset;
  },

  async queryOne(sql, params = {}) {
    const rows = await this.query(sql, params);
    return rows && rows.length ? rows[0] : null;
  }
};

require('dotenv').config({ path: '../.env' });
const sql = require('mssql');

async function run() {
  const config = {
    server: process.env.NEW_DB_SERVER,
    port: parseInt(process.env.NEW_DB_PORT),
    user: process.env.NEW_DB_USER,
    password: process.env.NEW_DB_PASSWORD,
    database: process.env.NEW_DB_NAME,
    options: {
      encrypt: false,
      trustServerCertificate: true,
    },
  };

  try {
    const pool = await sql.connect(config);
    const result = await pool.request().query("SELECT * FROM news_aspx_pages_temp WHERE FullPageUrl LIKE '%tan-cang-2.aspx%'");
    console.log(JSON.stringify(result.recordset, null, 2));
    await pool.close();
  } catch (err) {
    console.error(err);
  }
}

run();

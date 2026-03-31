require('dotenv').config();
const sql = require('mssql');

const oldDbConfig = {
  user: process.env.OLD_DB_USER,
  password: process.env.OLD_DB_PASSWORD,
  server: process.env.OLD_DB_SERVER,
  port: parseInt(process.env.OLD_DB_PORT),
  database: process.env.OLD_DB_NAME,
  options: { encrypt: false, requestTimeout: 30000 }
};

async function testDuplicates() {
  try {
    const listIdsStr = "'4DB4FFD7-152C-4EB7-85A6-3A41053664BD'"; // mission schedule
    
    let pool = await sql.connect(oldDbConfig);
    
    console.log("Connected. Running debug query...");
    const result = await pool.request().query(`
      SELECT ud.[tp_ID], COUNT(*) as duplicate_count
      FROM [DataEOfficeSNP].[dbo].[AllUserData] ud
      WHERE ud.[tp_ListId] IN (${listIdsStr})
      AND ud.tp_RowOrdinal = 0
      AND ud.[tp_IsCurrentVersion] = 1
      GROUP BY ud.[tp_ID]
      HAVING COUNT(*) > 1
    `);
    
    console.log("Duplicated tp_IDs in AllUserData:", result.recordset);

    const totalRaw = await pool.request().query(`
      SELECT COUNT(*) as total
      FROM [DataEOfficeSNP].[dbo].[AllUserData] ud
      WHERE ud.[tp_ListId] IN (${listIdsStr})
      AND ud.tp_RowOrdinal = 0
      AND ud.[tp_IsCurrentVersion] = 1
    `);
    console.log("Total unique tp_IDs if we don't group:", totalRaw.recordset);
    
  } catch (err) {
    console.error("Error:", err);
  } finally {
    process.exit();
  }
}

testDuplicates();

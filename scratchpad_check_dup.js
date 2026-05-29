const { connectToDatabase, sql } = require('./src/utils/dbNew'); // Hoặc db cũ, tùy
const sqlConfigOld = {
  user: process.env.OLD_DB_USER || 'app_dioffice',
  password: process.env.OLD_DB_PASSWORD || 'App#dioffice232',
  server: process.env.OLD_DB_SERVER || '10.1.253.41',
  database: process.env.OLD_DB_NAME || 'DataEOfficeSNP',
  port: parseInt(process.env.OLD_DB_PORT || '1433'),
  options: { encrypt: false, trustServerCertificate: true, requestTimeout: 300000 }
};

async function check() {
  const mssql = require('mssql');
  const pool = await mssql.connect(sqlConfigOld);
  const q = `
      SELECT i.[tp_ID] AS ID, i.tp_Level, i.tp_HasCopyDestinations, i.tp_CopySource, COUNT(*) as cnt
      FROM [WSS_Content_eoffice_cntt].[dbo].[AllUserData] i (NOLOCK)
      INNER JOIN [WSS_Content_eoffice_cntt].[dbo].[AllLists] l (NOLOCK) 
        ON i.[tp_ListId] = l.[tp_ID] 
      WHERE l.[tp_Title] = N'Lịch họp'
        AND i.[tp_RowOrdinal] = 0
        AND i.[tp_IsCurrentVersion] = 1
        AND i.[tp_DeleteTransactionId] = 0x0
        AND i.[tp_ID] = 1775
      GROUP BY i.[tp_ID], i.tp_Level, i.tp_HasCopyDestinations, i.tp_CopySource
  `;
  const res = await pool.request().query(q);
  console.log(res.recordset);
  
  const q2 = `
      SELECT *
      FROM [WSS_Content_eoffice_cntt].[dbo].[AllUserData] i (NOLOCK)
      INNER JOIN [WSS_Content_eoffice_cntt].[dbo].[AllLists] l (NOLOCK) 
        ON i.[tp_ListId] = l.[tp_ID] 
      WHERE l.[tp_Title] = N'Lịch họp'
        AND i.[tp_RowOrdinal] = 0
        AND i.[tp_IsCurrentVersion] = 1
        AND i.[tp_DeleteTransactionId] = 0x0
        AND i.[tp_ID] = 1775
  `;
  const res2 = await pool.request().query(q2);
  console.log('Fields differ between rows for ID=1775:');
  const rows = res2.recordset;
  if(rows.length > 1) {
    const keys = Object.keys(rows[0]);
    for(const key of keys) {
      if(rows[0][key] !== rows[1][key]) {
        console.log(`${key}: ${rows[0][key]} !== ${rows[1][key]}`);
      }
    }
  }
  process.exit(0);
}
check().catch(console.error);

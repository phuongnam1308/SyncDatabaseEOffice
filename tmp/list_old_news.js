const sql = require('mssql');
require('dotenv').config();

const config = {
    user: process.env.OLD_DB_USER,
    password: process.env.OLD_DB_PASSWORD,
    server: process.env.OLD_DB_SERVER,
    port: parseInt(process.env.OLD_DB_PORT) || 1433,
    database: process.env.OLD_DB_NAME,
    options: {
        encrypt: false, // Use true if on Azure
        trustServerCertificate: true
    }
};

async function listOldNews() {
    try {
        const pool = await sql.connect(config);
        const sharePointDb = process.env.SHAREPOINT_DB_NAME || 'WSS_Content_eoffice_khkd';
        
        const query = `
            SELECT TOP 20
                d.[Id] AS DocId,
                d.[DirName],
                d.[LeafName],
                d.[TimeCreated],
                d.[TimeLastModified],
                w.[FullUrl] AS WebUrl,
                w.[Title] AS WebTitle
            FROM [${sharePointDb}].[dbo].[AllDocs] d
            INNER JOIN [${sharePointDb}].[dbo].[AllWebs] w
                ON d.[SiteId] = w.[SiteId] AND d.[WebId]  = w.[Id]
            WHERE
                d.[DeleteTransactionId] = 0x0
                AND d.[IsCurrentVersion] = 1
                AND w.[FullUrl] LIKE '%tintuc%'
                AND d.[LeafName] LIKE '%.aspx'
            ORDER BY d.[TimeLastModified] DESC
        `;

        const result = await pool.request().query(query);
        console.log(JSON.stringify(result.recordset, null, 2));
        
        await pool.close();
    } catch (err) {
        console.error('Error connecting to old database:', err.message);
        process.exit(1);
    }
}

listOldNews();

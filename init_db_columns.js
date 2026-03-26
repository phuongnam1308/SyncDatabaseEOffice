const BaseModel = require('./models/BaseModel');

async function run() {
    const model = new BaseModel();
    try {
        await model.initialize();
        console.log('Connected to DB. Running ALTER TABLE commands...');

        const dbName = process.env.NEW_DB_NAME;
        const queries = [
            `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'files' AND COLUMN_NAME = 'nguoikyvanban') ALTER TABLE ${dbName}.dbo.files ADD nguoikyvanban NVARCHAR(MAX) NULL;`,
            `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'files' AND COLUMN_NAME = 'id_bak') ALTER TABLE ${dbName}.dbo.files ADD id_bak NVARCHAR(MAX) NULL;`,
            `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'files' AND COLUMN_NAME = 'table_bak') ALTER TABLE ${dbName}.dbo.files ADD table_bak NVARCHAR(MAX) NULL;`,
            `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'files' AND COLUMN_NAME = 'type_doc') ALTER TABLE ${dbName}.dbo.files ADD type_doc NVARCHAR(MAX) NULL;`,
            `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'files' AND COLUMN_NAME = 'isBak') ALTER TABLE ${dbName}.dbo.files ADD isBak INT DEFAULT 0;`,
            
            `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'document_comments' AND COLUMN_NAME = 'tb_bak') ALTER TABLE ${dbName}.dbo.document_comments ADD tb_bak INT DEFAULT 0;`,
            `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'document_comments' AND COLUMN_NAME = 'user_id_bak') ALTER TABLE ${dbName}.dbo.document_comments ADD user_id_bak NVARCHAR(255) NULL;`,
            
            `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'audit' AND COLUMN_NAME = 'table_backups') ALTER TABLE ${dbName}.dbo.audit ADD table_backups NVARCHAR(MAX) NULL;`,
            `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'audit' AND COLUMN_NAME = 'type_document') ALTER TABLE ${dbName}.dbo.audit ADD type_document NVARCHAR(255) NULL;`
        ];

        for (const q of queries) {
            try {
                await model.queryNewDb(q);
                console.log(`Executed successfully: ${q.substring(0, 150)}...`);
            } catch (err) {
                console.error(`Failed: ${q.substring(0, 150)}... Error: ${err.message}`);
            }
        }
        
    } catch(err) {
        console.error('Initialization script failed:', err);
    } finally {
        if (model.newPool) await model.newPool.close();
        if (model.oldPool) await model.oldPool.close();
    }
}

require('dotenv').config();
run();


const dbConnection = require('../db/connection');
const OutGoingDocumentModel = require('../src/sync-outgoing-document/models/StreamOutgoingIncrementalModel');
const DrafterMigrationService = require('../services/DrafterMigrationService');

async function runPreview() {
  const model = new OutGoingDocumentModel();
  try {
    console.log('Connecting to NEW database only...');
    const newPool = await dbConnection.connectNewDb();
    model.newPool = newPool;
    
    // Manually run initialization steps that don't require old pool
    await model.ensureStagingTableExists();
    // In StreamOutgoingIncrementalModel, initialize also adds columns to outgoing_documents
    // We can call it manually since we have newPool
    const tableScripts = `
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'status_code')
            ALTER TABLE dbo.outgoing_documents ADD status_code VARCHAR(20) DEFAULT '1' NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'drafter')
            ALTER TABLE dbo.outgoing_documents ADD drafter VARCHAR(100) NULL;
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'outgoing_documents' AND COLUMN_NAME = 'report_signer')
            ALTER TABLE dbo.outgoing_documents ADD report_signer VARCHAR(100) NULL;
    `;
    await model.queryNewDb(tableScripts);

    const service = new DrafterMigrationService(model);
    console.log('--- START PREVIEW ---');
    const result = await service.preview();
    console.log('Preview Result:', JSON.stringify(result, null, 2));
    console.log('--- END PREVIEW ---');
  } catch (error) {
    console.error('Error running preview:', error);
  } finally {
    await dbConnection.closeAll();
  }
}

runPreview();

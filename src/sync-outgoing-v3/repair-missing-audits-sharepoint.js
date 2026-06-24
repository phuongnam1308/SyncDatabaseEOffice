const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const dbConnection = require('../../db/connection');
const logger = require('../../utils/logger');
const DraftDocumentUpsertHandler = require('./models/DraftDocumentUpsertHandler');
const dbUtils = require('../../utils/dbUtils');

async function main() {
  logger.info('========================================================');
  logger.info('[Repair-SharePoint] Starting Repair Script for SharePoint Audits...');
  logger.info('========================================================');

  // Initialize DB Connections (Only needs target/new DB, but connectAll handles both)
  await dbConnection.connectAll();
  const oldPool = dbConnection.getOldPool();
  const newPool = dbConnection.getNewPool();

  // Initialize Draft Document Handler (used for SharePoint drafts too)
  const draftUpsertHandler = new DraftDocumentUpsertHandler(newPool, oldPool);
  await draftUpsertHandler.initialize();

  // 1. Fetch outgoing_documents that are missing audits and belong to SharePoint list unit drafts
  const queryMissing = `
    SELECT od.document_id, od.id_outgoing_bak, od.drafter, od.table_backups, od.created_at
    FROM dbo.outgoing_documents od
    WHERE od.table_backups = 'draft_documents_unit_sync'
      AND NOT EXISTS (
          SELECT 1 
          FROM dbo.audit a 
          WHERE a.document_id = od.document_id 
            AND a.type_document = 'OutgoingDocument'
      )
  `;
  
  logger.info('[Repair-SharePoint] Querying documents with missing audits...');
  const missingResult = await newPool.request().query(queryMissing);
  const records = missingResult.recordset || [];
  
  logger.info(`[Repair-SharePoint] Found ${records.length} SharePoint unit drafts that require audit repair.`);
  if (records.length === 0) {
    logger.info('[Repair-SharePoint] All SharePoint documents already have audits. Nothing to repair.');
    process.exit(0);
  }

  // Pre-load all user display names from target DB to resolve drafter names
  logger.info('[Repair-SharePoint] Pre-loading user display names from target DB...');
  const userResult = await newPool.request().query('SELECT id, name FROM dbo.users');
  const userMap = new Map(userResult.recordset.map(u => [String(u.id).toLowerCase(), u.name]));

  let successCount = 0;
  let failCount = 0;

  logger.info('[Repair-SharePoint] Processing missing audits for SharePoint documents...');

  // Helper to extract clean numeric ID from id_outgoing_bak
  const getCleanOldId = (idBak) => {
    if (!idBak) return '';
    // e.g. "SHP_UNIT_295252" -> "295252"
    const parts = String(idBak).split('_');
    return parts[parts.length - 1].trim();
  };

  // Process sequentially to ensure transactional safety
  for (let i = 0; i < records.length; i++) {
    const doc = records[i];
    const key = doc.id_outgoing_bak;
    const cleanOldId = getCleanOldId(doc.id_outgoing_bak);

    const drafterName = doc.drafter ? userMap.get(String(doc.drafter).toLowerCase()) : null;

    // Create mock oldRecord in memory
    const oldRecord = {
      ID: cleanOldId || '0',
      CreatedBy: drafterName || '',
      Created: doc.created_at || new Date()
    };

    try {
      await dbUtils.withTransactionRetry(newPool, async (transaction) => {
        // Run _processAudits (creates audit and outgoing_assignment)
        await draftUpsertHandler._processAudits(
          oldRecord,
          doc.document_id,
          String(oldRecord.ID).trim(),
          doc.drafter,
          transaction,
          false // isNew = false
        );
      });

      // Refresh outgoing_current_state using direct refresh
      if (typeof draftUpsertHandler._refreshCurrentStateDirect === 'function') {
        await draftUpsertHandler._refreshCurrentStateDirect(doc.document_id);
      }

      successCount++;
    } catch (err) {
      logger.error(`[Repair-SharePoint] Failed for document_id=${doc.document_id}: ${err.message}`);
      failCount++;
    }

    if ((i + 1) % 100 === 0 || i === records.length - 1) {
      logger.info(`[Repair-SharePoint] Progress: ${i + 1}/${records.length} processed. (Success: ${successCount}, Fail: ${failCount})`);
    }
  }

  logger.info('========================================================');
  logger.info(`[Repair-SharePoint] Completed! Success: ${successCount}, Fail: ${failCount}`);
  logger.info('========================================================');
  process.exit(0);
}

main().catch(err => {
  logger.error(`[Repair-SharePoint] Fatal error: ${err.message}`);
  logger.error(err.stack);
  process.exit(1);
});

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const dbConnection = require('../../db/connection');
const logger = require('../../utils/logger');
const UpsertHandler = require('./models/UpsertHandler');
const DraftDocumentUpsertHandler = require('./models/DraftDocumentUpsertHandler');
const dbUtils = require('../../utils/dbUtils');

async function main() {
  logger.info('========================================================');
  logger.info('[Repair] Starting Repair Script for Missing Audits...');
  logger.info('========================================================');

  // Initialize DB Connections
  await dbConnection.connectAll();
  const oldPool = dbConnection.getOldPool();
  const newPool = dbConnection.getNewPool();

  // Initialize Handlers
  const upsertHandler = new UpsertHandler(newPool, oldPool);
  await upsertHandler.initialize();

  const draftUpsertHandler = new DraftDocumentUpsertHandler(newPool, oldPool);
  await draftUpsertHandler.initialize();

  // 1. Fetch outgoing_documents that are missing audits
  const queryMissing = `
    SELECT od.document_id, od.id_outgoing_bak, od.drafter, od.table_backups
    FROM dbo.outgoing_documents od
    WHERE (od.table_backups IN ('outgoing_documents_sync', 'draft_documents_sync') OR od.table_backups IS NULL)
      AND NOT EXISTS (
          SELECT 1 
          FROM dbo.audit a 
          WHERE a.document_id = od.document_id 
            AND a.type_document = 'OutgoingDocument'
      )
  `;
  
  logger.info('[Repair] Querying documents with missing audits...');
  const missingResult = await newPool.request().query(queryMissing);
  const records = missingResult.recordset || [];
  
  logger.info(`[Repair] Found ${records.length} documents that require audit repair.`);
  if (records.length === 0) {
    logger.info('[Repair] All documents already have audits. Nothing to repair.');
    process.exit(0);
  }

  let successCount = 0;
  let failCount = 0;

  // Split into Draft and Outgoing for batch old DB queries
  const draftDocs = records.filter(r => r.table_backups === 'draft_documents_sync');
  const outgoingDocs = records.filter(r => r.table_backups !== 'draft_documents_sync');

  logger.info(`[Repair] Categorized: Drafts (v3): ${draftDocs.length}, Outgoing (v2): ${outgoingDocs.length}`);

  // Helper to extract clean numeric ID from id_outgoing_bak
  const getCleanOldId = (idBak) => {
    if (!idBak) return '';
    // e.g. "204837_DRAFT" -> "204837", "15257_DI" -> "15257", "15257_TCMT" -> "15257"
    return String(idBak).split('_')[0].trim();
  };

  // Map to hold old records fetched from old DB
  const oldRecordsMap = new Map();

  // Fetch Draft old records in batches from SNP.CodeItem
  const batchSize = 100;
  if (draftDocs.length > 0) {
    logger.info('[Repair] Fetching draft source records from SNP.CodeItem...');
    for (let i = 0; i < draftDocs.length; i += batchSize) {
      const chunk = draftDocs.slice(i, i + batchSize);
      const ids = chunk
        .map(r => getCleanOldId(r.id_outgoing_bak))
        .filter(id => id && /^\d+$/.test(id));

      if (ids.length === 0) continue;

      const placeholders = ids.map((_, idx) => `@id_${idx}`).join(', ');
      const query = `SELECT * FROM SNP.CodeItem WHERE ID IN (${placeholders})`;
      const request = oldPool.request();
      ids.forEach((id, idx) => request.input(`id_${idx}`, id));
      
      const result = await request.query(query);
      for (const row of result.recordset || []) {
        const cleanId = String(row.ID).trim();
        const doc = chunk.find(c => getCleanOldId(c.id_outgoing_bak) === cleanId);
        if (doc) {
          oldRecordsMap.set(doc.id_outgoing_bak, row);
        }
      }
    }
  }

  // Fetch Outgoing old records in batches from dbo.VanBanBanHanh
  if (outgoingDocs.length > 0) {
    logger.info('[Repair] Fetching outgoing source records from dbo.VanBanBanHanh...');
    for (let i = 0; i < outgoingDocs.length; i += batchSize) {
      const chunk = outgoingDocs.slice(i, i + batchSize);
      const ids = chunk
        .map(r => getCleanOldId(r.id_outgoing_bak))
        .filter(id => id && /^\d+$/.test(id));

      if (ids.length === 0) continue;

      const placeholders = ids.map((_, idx) => `@id_${idx}`).join(', ');
      const query = `SELECT * FROM dbo.VanBanBanHanh WHERE ID IN (${placeholders})`;
      const request = oldPool.request();
      ids.forEach((id, idx) => request.input(`id_${idx}`, id));
      
      const result = await request.query(query);
      for (const row of result.recordset || []) {
        const cleanId = String(row.ID).trim();
        const doc = chunk.find(c => getCleanOldId(c.id_outgoing_bak) === cleanId);
        if (doc) {
          oldRecordsMap.set(doc.id_outgoing_bak, row);
        }
      }
    }
  }

  logger.info('[Repair] Processing missing audits...');

  // Process sequentially to avoid deadlocks and ensure transactional safety
  for (let i = 0; i < records.length; i++) {
    const doc = records[i];
    const isDraft = doc.table_backups === 'draft_documents_sync';
    const key = doc.id_outgoing_bak;
    const oldRecord = oldRecordsMap.get(key);

    if (!oldRecord) {
      logger.warn(`[Repair] Source record not found in old DB for key: ${key}. Skipping.`);
      failCount++;
      continue;
    }

    const handler = isDraft ? draftUpsertHandler : upsertHandler;

    try {
      await dbUtils.withTransactionRetry(newPool, async (transaction) => {
        // Run _processAudits (this creates audit and outgoing_assignment)
        await handler._processAudits(
          oldRecord,
          doc.document_id,
          String(oldRecord.ID).trim(),
          doc.drafter,
          transaction,
          false // isNew = false
        );
      });

      // Refresh outgoing_current_state
      if (typeof handler._refreshCurrentStates === 'function') {
        await handler._refreshCurrentStates([doc.document_id]);
      } else if (typeof handler._refreshCurrentStateDirect === 'function') {
        await handler._refreshCurrentStateDirect(doc.document_id);
      }

      successCount++;
    } catch (err) {
      logger.error(`[Repair] Failed for document_id=${doc.document_id} (${isDraft ? 'Draft' : 'Outgoing'}): ${err.message}`);
      failCount++;
    }

    if ((i + 1) % 100 === 0 || i === records.length - 1) {
      logger.info(`[Repair] Progress: ${i + 1}/${records.length} processed. (Success: ${successCount}, Fail: ${failCount})`);
    }
  }

  logger.info('========================================================');
  logger.info(`[Repair] Completed! Success: ${successCount}, Fail: ${failCount}`);
  logger.info('========================================================');
  process.exit(0);
}

main().catch(err => {
  logger.error(`[Repair] Fatal error: ${err.message}`);
  logger.error(err.stack);
  process.exit(1);
});

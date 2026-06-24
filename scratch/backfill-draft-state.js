/**
 * Scratch script to backfill outgoing_assignment and outgoing_current_state
 * for all migrated draft documents.
 * Usage: node scratch/backfill-draft-state.js
 */

const dbConnection = require('../db/connection');
const logger = require('../utils/logger');
const dbUtils = require('../utils/dbUtils');
const DraftDocumentUpsertHandler = require('../src/sync-outgoing-v3/models/DraftDocumentUpsertHandler');

async function main() {
  logger.info('==================================================');
  logger.info('🚀 STARTING BACKFILL DRAFT STATE');
  logger.info('==================================================');

  await dbConnection.connectAll();
  const newPool = dbConnection.getNewPool();
  const oldPool = dbConnection.getOldPool();

  const handler = new DraftDocumentUpsertHandler(newPool, oldPool);
  await handler.initialize();

  try {
    // 1. Fetch all draft documents
    const query = `
      SELECT DISTINCT document_id, drafter
      FROM dbo.outgoing_documents
      WHERE document_id LIKE '%_DRAFT'
    `;
    const draftDocs = await newPool.request().query(query);
    const records = draftDocs.recordset || [];

    logger.info(`Found ${records.length} draft documents to backfill.`);

    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < records.length; i++) {
      const doc = records[i];
      const docId = doc.document_id;
      logger.info(`[${i + 1}/${records.length}] Processing docId: ${docId}`);

      try {
        await dbUtils.withTransactionRetry(newPool, async (transaction) => {
          // Fetch all audit logs for this document
          const auditQuery = `
            SELECT id, document_id, [time], receiver, receiver_unit, created_by, roleProcess, stage_status, action_code
            FROM dbo.audit
            WHERE document_id = @docId
          `;

          const auditRequest = transaction.request();
          auditRequest.input('docId', docId);
          const auditResult = await auditRequest.query(auditQuery);
          const auditRows = auditResult.recordset || [];

          // Sync each audit to outgoing_assignment
          for (const auditRow of auditRows) {
            await handler._syncToAssignment(auditRow, transaction);
          }

          // Refresh outgoing_current_state
          await handler._refreshCurrentStateDirect(docId, transaction);
        });
        successCount++;
      } catch (err) {
        failedCount++;
        logger.error(`Failed to backfill for docId: ${docId}. Error: ${err.message}`);
      }
    }

    logger.info('==================================================');
    logger.info('🎉 BACKFILL COMPLETED!');
    logger.info(`Success: ${successCount}`);
    logger.info(`Failed: ${failedCount}`);
    logger.info('==================================================');
    process.exit(0);
  } catch (error) {
    logger.error(`Fatal backfill error: ${error.message}`);
    process.exit(1);
  }
}

main();

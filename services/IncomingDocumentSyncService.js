const db = require('../db/connection');
const logger = require('../utils/logger');

class MigrationIncomingDocumentService {
  static async migrateIncomingDocuments(fromDate = null, toDate = null) {
    const pool = await db;

    logger.info(
      `Migrate incoming2 → incoming | fromDate=${fromDate} | toDate=${toDate}`
    );

    const request = pool.request();

    request.input('fromDate', fromDate);
    request.input('toDate', toDate);

    const result = await request.execute(
      'dbo.sp_migrate_incoming2_to_incoming'
    );

    return {
      rowsAffected: result.rowsAffected?.[0] || 0
    };
  }
}

module.exports = MigrationIncomingDocumentService;

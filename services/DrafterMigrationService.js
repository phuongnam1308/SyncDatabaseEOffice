// services/DrafterMigrationService.js
const logger = require('../utils/logger');

class DrafterMigrationService {
  constructor(model) {
    this.model = model;
  }

  // ================= PREVIEW =================
  async preview() {
    const query = `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN drafter IS NULL THEN 1 ELSE 0 END) AS drafter_null,
        SUM(CASE WHEN report_signer IS NULL THEN 1 ELSE 0 END) AS report_signer_null
      FROM ${process.env.NEW_DB_NAME}.dbo.outgoing_documents
    `;
    const { recordset } = await this.model.newPool.request().query(query);
    return recordset[0];
  }

  // ================= MIGRATE =================
  async migrate(batchSize = 5000) {
    let totalUpdated = 0;
    let batch = 0;
    let hasMore = true;

    while (hasMore) {
      batch++;
      logger.info(`[Batch ${batch}] migrate drafter + draft_signer`);

      const query = `
        UPDATE o
        SET
          -- 1. drafter = USER ID from NguoiSoanThaoText (always prefer resolved ID)
          o.drafter = COALESCE(u1.id, u2.id, o.drafter),

          -- 2. report_signer = USER ID from NguoiKyVanBanText (always prefer resolved ID)
          o.report_signer = COALESCE(u2.id, u1.id, o.report_signer)
        FROM ${process.env.NEW_DB_NAME}.dbo.outgoing_documents o
        LEFT JOIN ${process.env.NEW_DB_NAME}.dbo.users u1
          ON LTRIM(RTRIM(o.NguoiSoanThaoText)) = LTRIM(RTRIM(u1.name))
        LEFT JOIN ${process.env.NEW_DB_NAME}.dbo.users u2
          ON LTRIM(RTRIM(o.NguoiKyVanBanText)) = LTRIM(RTRIM(u2.name))
        WHERE o.id IN (
          SELECT TOP (${batchSize}) id
          FROM ${process.env.NEW_DB_NAME}.dbo.outgoing_documents
          WHERE (drafter IS NULL OR report_signer IS NULL 
                 OR (drafter NOT IN (SELECT id FROM ${process.env.NEW_DB_NAME}.dbo.users))
                 OR (report_signer NOT IN (SELECT id FROM ${process.env.NEW_DB_NAME}.dbo.users)))
          ORDER BY id
        );

        SELECT @@ROWCOUNT AS updated;
      `;

      const result = await this.model.newPool.request().query(query);
      const updated = result.recordset?.[0]?.updated || 0;

      totalUpdated += updated;
      logger.info(`[Batch ${batch}] updated=${updated}, total=${totalUpdated}`);

      if (updated < batchSize) hasMore = false;
    }

    return {
      success: true,
      totalUpdated,
      batchCount: batch
    };
  }
}

module.exports = DrafterMigrationService;

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
        SUM(CASE WHEN draft_signer IS NULL THEN 1 ELSE 0 END) AS draft_signer_null
      FROM DiOffice.dbo.outgoing_documents2
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
          -- 1. drafter = TEXT (người soạn)
          o.drafter = CASE
            WHEN o.drafter IS NULL THEN
              COALESCE(
                NULLIF(LTRIM(RTRIM(o.NguoiSoanThaoText)), ''),
                NULLIF(LTRIM(RTRIM(o.NguoiKyVanBanText)), '')
              )
            ELSE o.drafter
          END,

          -- 2. draft_signer = USER ID (người ký)
          o.draft_signer = CASE
            WHEN o.draft_signer IS NULL AND u.id IS NOT NULL
              THEN u.id
            ELSE o.draft_signer
          END
        FROM DiOffice.dbo.outgoing_documents2 o
        LEFT JOIN DiOffice.dbo.users u
          ON LTRIM(RTRIM(o.NguoiKyVanBanText)) = LTRIM(RTRIM(u.name))
        WHERE o.id IN (
          SELECT TOP (${batchSize}) id
          FROM DiOffice.dbo.outgoing_documents2
          WHERE drafter IS NULL OR draft_signer IS NULL
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

const DocumentCommentsMigrationModel =
  require('../models/DocumentCommentsMigrationModel');
const {
  documentCommentsMigration
} = require('../config/documentCommentsMigration.config');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class MigrationDocumentCommentsService {
  constructor() {
    this.model = new DocumentCommentsMigrationModel();
    this.cfg = documentCommentsMigration;
  }

  async initialize() {
    await this.model.initialize();
  }

  async migrate() {
    logger.info('=== MIGRATE COMMENTS THEO CONFIG (FIX CONTENT NULL) ===');

    const rows = await this.model.getAllSource();

    let inserted = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of rows) {
      try {
        // 1️⃣ Bỏ qua nếu đã migrate
        if (await this.model.existsByBackupId(row.ID)) {
          skipped++;
          continue;
        }

        // 2️⃣ Record insert
        const record = {
          id: uuidv4(),
          created_at: new Date(),
          updated_at: new Date(),
          table_bak: this.cfg.tableBakName,
          ...this.cfg.defaultFields
        };

        // 3️⃣ Map dữ liệu theo config + FIX NULL
        for (const [targetField, sourceField] of
          Object.entries(this.cfg.mapping)) {

          let value = row[sourceField];

          // FIX CỨNG: content KHÔNG ĐƯỢC NULL
          if (
            targetField === 'content' &&
            (value === null || value === undefined)
          ) {
            value = '';
          }

          record[targetField] = value;
        }

        // 4️⃣ Insert
        await this.model.insert(record);
        inserted++;

      } catch (err) {
        errors++;
        logger.error(
          `Lỗi migrate comment ID=${row.ID}`,
          err
        );
      }
    }

    return {
      total: rows.length,
      inserted,
      skipped,
      errors
    };
  }
}

module.exports = MigrationDocumentCommentsService;

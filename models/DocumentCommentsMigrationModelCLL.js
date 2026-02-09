const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const {
  documentCommentsMigration
} = require('../config/documentCommentsMigrationCLL.config');

class DocumentCommentsMigrationModelCLL extends BaseModel {
  constructor() {
    super();
    this.cfg = documentCommentsMigration;
  }

  /**
   * Khởi tạo connection DB cũ + mới
   */
  async initialize() {
    await super.initialize();
  }

  /**
   * 🔥 Lấy batch từ DB CŨ
   * ❌ KHÔNG dùng MigrateFlg
   * ❌ KHÔNG dùng tb_update
   */
  async getBatch(limit = 500) {
    const { source, mapping } = this.cfg;
    const sourceFields = Object.values(mapping).join(', ');

    const query = `
      SELECT TOP (${limit}) ${sourceFields}
      FROM ${source.database}.${source.schema}.${source.table}
      ORDER BY ID
    `;

    return await this.queryOldDb(query);
  }

  /**
   * Check đã migrate chưa (dựa DB MỚI)
   */
  async existsByBackupId(idBak) {
    const { target } = this.cfg;

    const query = `
      SELECT 1
      FROM ${target.database}.${target.schema}.${target.table}
      WHERE id_comments_bak = @idBak
    `;

    const res = await this.queryNewDb(query, { idBak });
    return res.length > 0;
  }

  /**
   * Insert sang bảng mới
   */
  async insert(record) {
    const { target } = this.cfg;

    const fields = Object.keys(record);
    const params = fields.map((_, i) => `@p${i}`).join(', ');

    const query = `
      INSERT INTO ${target.database}.${target.schema}.${target.table}
      (${fields.join(', ')})
      VALUES (${params})
    `;

    const request = this.newPool.request();
    fields.forEach((f, i) => request.input(`p${i}`, record[f]));

    await request.query(query);
  }

  /**
   * 🔥 HÀM MIGRATE CHÍNH
   * 👉 Không update DB cũ
   */
  async migrate(batchSize = 500) {
    const rows = await this.getBatch(batchSize);
    if (!rows || rows.length === 0) return 0;

    let inserted = 0;

    for (const row of rows) {
      const idBak = row.ID || row.Id || row.id;

      try {
        if (!idBak) {
          logger.warn('[COMMENTS MIGRATE] Thiếu ID backup, bỏ qua record');
          continue;
        }

        const existed = await this.existsByBackupId(idBak);
        if (existed) continue;

        const record = this.mapToTarget(row);
        await this.insert(record);

        inserted++;
      } catch (err) {
        logger.error(
          `[COMMENTS MIGRATE] Lỗi ID=${idBak}: ${err.message}`
        );
      }
    }

    return inserted;
  }

  /**
   * Map source → target
   */
  mapToTarget(row) {
    const { mapping } = this.cfg;
    const record = {};

    for (const [targetField, sourceField] of Object.entries(mapping)) {
      record[targetField] =
        row[sourceField] !== undefined ? row[sourceField] : null;
    }

    // bắt buộc
    record.id = record.id || uuidv4();
    record.id_comments_bak = row.ID || row.Id || row.id;

    return record;
  }
}

module.exports = DocumentCommentsMigrationModelCLL;

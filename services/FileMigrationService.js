const path = require('path');
const mime = require('mime-types');
const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * KHÔNG CONFIG – hard-code trực tiếp
 */
const DEFAULTS = {
  FILE_SIZE: 0,
  IS_DIRECTORY: 0,
  STATUS: 1,
  VERSION: 1,
  IS_SIGNED_FILE: 0,
  NUMBER_OF_SIGNED_FILE: 0,
  STORAGE_TYPE: 'filesystem',
  TABLE_BAK: 'vanbanbanhanh',
  IS_BAK: 1
};

class FileMigrationService {
  constructor(model) {
    this.model = model;
  }

  parseFiles(files) {
    if (!files) return [];
    return files
      .split('|')
      .map(f => f.trim())
      .filter(Boolean);
  }

  async migrate() {
    logger.info('===== START MIGRATE FILES VANBANBANHANH =====');

    const rows = await this.model.getOldData();
    let inserted = 0;
    let skipped = 0;

    for (const r of rows) {
      try {
        if (!r.Files) {
          skipped++;
          continue;
        }

        const existed = await this.model.existedByBakId(r.ID);
        if (existed) {
          logger.warn(`[FILES][SKIP] ID=${r.ID} existed`);
          skipped++;
          continue;
        }

        const files = this.parseFiles(r.Files);
        if (!files.length) {
          skipped++;
          continue;
        }

        for (const file of files) {
          const data = {
            id: crypto.randomUUID(),
            file_name: path.basename(file),
            file_path: file,
            mime_type:
              mime.lookup(path.extname(file)) || 'application/octet-stream',
            file_size: DEFAULTS.FILE_SIZE,
            description: r.TrichYeu,
            is_directory: DEFAULTS.IS_DIRECTORY,
            parent_id: null,
            created_by: r.CreatedBy,
            created_at: r.Created,
            updated_at: r.Modified,
            status: DEFAULTS.STATUS,
            version: DEFAULTS.VERSION,
            is_signed_file: DEFAULTS.IS_SIGNED_FILE,
            number_of_signed_file: DEFAULTS.NUMBER_OF_SIGNED_FILE,
            storage_path: file,
            storage_type: DEFAULTS.STORAGE_TYPE,
            isNumbered: r.ChenSo,
            typeSize: r.SoTrang,
            id_bak: r.ID,
            table_bak: DEFAULTS.TABLE_BAK,
            type_doc: r.LoaiVanBan,
            isBak: DEFAULTS.IS_BAK,
            nguoikyvanban: r.NguoiKyVanBan
          };

          await this.model.insert(data);
          inserted++;
        }
      } catch (err) {
        logger.error(`[FILES][ERROR] ID=${r.ID} | ${err.message}`);
      }
    }

    logger.info(
      `===== END MIGRATE FILES | inserted=${inserted} | skipped=${skipped} =====`
    );

    return { inserted, skipped };
  }
}

module.exports = FileMigrationService;

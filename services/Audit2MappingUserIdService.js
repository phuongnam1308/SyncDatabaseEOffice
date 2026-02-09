const Audit2MappingUserIdModel =
  require('../models/Audit2MappingUserIdModel');
const logger = require('../utils/logger');

class Audit2MappingUserIdService {
  constructor() {
    this.model = new Audit2MappingUserIdModel();
  }

  async initialize() {
    await this.model.initialize();
  }

  async mapUserIdForAudit2() {
    logger.info('=== START MAP USER_ID FOR AUDIT2 ===');

    const audits = await this.model.getAuditsNeedMapping();

    let mapped = 0;
    let skipped = 0;

    for (const audit of audits) {
      try {
        const name = audit.display_name || audit.NguoiXuLy;
        if (!name) {
          skipped++;
          continue;
        }

        const user = await this.model.findUserByNameLike(name);
        if (!user) {
          skipped++;
          continue;
        }

        await this.model.updateUserId(audit.id, user.id);
        mapped++;
      } catch (err) {
        logger.error(
          `Lỗi map audit_id=${audit.id}: ${err.message}`
        );
        skipped++;
      }
    }

    return {
      total: audits.length,
      mapped,
      skipped
    };
  }
}

module.exports = Audit2MappingUserIdService;

const Audit2RoleProcessSyncModel =
  require('../models/Audit2RoleProcessSyncModel');
const logger = require('../utils/logger');

class Audit2RoleProcessSyncService {
  constructor() {
    this.model = new Audit2RoleProcessSyncModel();
  }

  async initialize() {
    await this.model.initialize();
  }

  async syncRoleProcess() {
    logger.info('=== START SYNC ROLE & ROLEPROCESS FOR AUDIT2 ===');

    const audits = await this.model.getAuditsNeedSync();

    let updated = 0;
    let skipped = 0;

    for (const audit of audits) {
      try {
        let role = null;
        let roleProcess = null;

        if (audit.HanhDong) {
          roleProcess =
            await this.model.getRoleProcessByHanhDong(audit.HanhDong);
        }

        if (audit.NguoiXuLy) {
          role =
            await this.model.getRoleMappingByNguoiXuLy(audit.NguoiXuLy);
        }

        // DEFAULT
        if (!role) role = 'CAN_BO';
        if (!roleProcess) roleProcess = 'processor';

        await this.model.updateRole(audit.id, role, roleProcess);
        updated++;
      } catch (err) {
        logger.error(
          `Sync role failed audit_id=${audit.id}: ${err.message}`
        );
        skipped++;
      }
    }

    return {
      total: audits.length,
      updated,
      skipped
    };
  }
}

module.exports = Audit2RoleProcessSyncService;

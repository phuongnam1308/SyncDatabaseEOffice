const OutgoingToAuditTestModel =
  require('../models/OutgoingToAuditTestModel');
const logger = require('../utils/logger'); // dùng logger hệ thống

class OutgoingToAuditTestService {
  constructor() {
    this.model = new OutgoingToAuditTestModel();
  }

  async initialize() {
    await this.model.initialize();
  }

  async createAudit(payload) {
    const {
      user_id,
      role,
      action_code,
      receiver,
      receiver_unit,
      roleProcess,
      action,
      stage_status
    } = payload;

    if (!user_id || !role || !action_code) {
      throw new Error('user_id, role và action_code là bắt buộc');
    }

    logger.info('=== START CREATE AUDIT TEST ===');
    logger.info(`User: ${user_id} | Role: ${role} | ActionCode: ${action_code}`);

    const outgoingList = await this.model.getOutgoingTestData();
    logger.info(`Total outgoing_documents2: ${outgoingList.length}`);

    let inserted = 0;

    for (let i = 0; i < outgoingList.length; i++) {
      const row = outgoingList[i];

      logger.info(
        `[${i + 1}/${outgoingList.length}] Insert audit | document_id=${row.document_id}`
      );

      await this.model.insertAudit({
        document_id: row.document_id,
        origin_id: row.document_id,
        time: row.created_at,
        user_id,
        role,
        action_code,
        created_by: user_id,
        receiver,
        receiver_unit,
        roleProcess,
        action,
        stage_status
      });

      inserted++;
    }

    logger.info(`=== END CREATE AUDIT TEST | INSERTED ${inserted} RECORDS ===`);

    return {
      success: true,
      total: outgoingList.length,
      inserted
    };
  }
}

module.exports = OutgoingToAuditTestService;

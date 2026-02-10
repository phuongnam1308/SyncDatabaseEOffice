const OutgoingToAuditTestModel =
  require('../models/OutgoingToAuditTestModel');
const logger = require('../utils/logger');

class OutgoingToAuditTestService {
  constructor() {
    this.model = new OutgoingToAuditTestModel();
  }

  async initialize() {
    await this.model.initialize();
  }

  async createAudit() {
    // ===== FIX CỨNG DATA =====
    const user_id = '6915f2387e39c2ba33cef79a';
    const role = 'VAN_THU';
    const action_code = 'CREATE';
    const receiver = '6915f2387e39c2ba33cef79a';
    const receiver_unit = '68afb3a1cb36081f0bba5dd6';
    const roleProcess = 'VAN_THU';
    const action = 'Tạo văn bản';
    const stage_status = 'DA_XU_LY';
    // ========================

    logger.info('=== START CREATE AUDIT TEST (FIXED DATA MODE) ===');
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

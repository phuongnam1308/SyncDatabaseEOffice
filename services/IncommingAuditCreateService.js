const IncommingAuditCreateModel =
  require('../models/IncommingAuditCreateModel');
const logger = require('../utils/logger');

class IncommingAuditCreateService {
  constructor() {
    this.model = new IncommingAuditCreateModel();
  }

  async initialize() {
    await this.model.initialize();
  }

  async createAudit(payload) {
    const {
      display_name,
      role = 'VAN_THU',
      action_code = 'CREATE',
      group_ = null,
      roleProcess = 'VAN_THU',
      stage_status = 'CHUA_XU_LY',
      curStatusCode = 1
    } = payload;

    const docs = await this.model.getIncommingDocs();
    let inserted = 0;

    for (const doc of docs) {
      logger.info(
        `[AUDIT CREATE] document_id=${doc.document_id}`
      );

      await this.model.insertAudit({
        document_id: doc.document_id,
        user_id: doc.sender_unit,
        display_name,
        role,
        action_code,
        to_node_id: 'Gateway_0wb5flm',
        origin_id: doc.document_id,
        created_by: doc.sender_unit,
        receiver: doc.receiver_unit,
        receiver_unit: doc.receiver_unit,
        group_,
        roleProcess,
        action: 'Tạo văn bản',
        stage_status,
        curStatusCode,
        type_document: 'IncommingDocument',
        table_backups: 'test_vanbanden'
      });

      inserted++;
    }

    return {
      success: true,
      total: docs.length,
      inserted
    };
  }
}

module.exports = IncommingAuditCreateService;

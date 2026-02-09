const IncommingBpmnVersionTestModel =
  require('../models/IncommingBpmnVersionTestModel');
const logger = require('../utils/logger');

class IncommingBpmnVersionTestService {
  constructor() {
    this.model = new IncommingBpmnVersionTestModel();
  }

  async initialize() {
    await this.model.initialize();
  }

  async update(payload) {
    let { bpmn_version } = payload;

    // 👇 mặc định nếu không nhập
    if (!bpmn_version) {
      bpmn_version = 'PHUC_DAP_DV_CON';
    }

    logger.info(
      `Update bpmn_version incomming_documents2 => ${bpmn_version}`
    );

    const total = await this.model.countData();
    const updated = await this.model.updateBpmnVersion(bpmn_version);

    return {
      success: true,
      total,
      updated,
      bpmn_version
    };
  }
}

module.exports = IncommingBpmnVersionTestService;

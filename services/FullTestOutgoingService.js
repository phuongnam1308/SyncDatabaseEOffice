const OutgoingBackupBeforeTestService = require('./OutgoingBackupBeforeTestService');
const OutgoingFakeDataService = require('./OutgoingFakeDataService');
const OutgoingToAuditTestService = require('./OutgoingToAuditTestService');
const logger = require('../utils/logger');

class FullTestOutgoingService {
  constructor() {
    this.backupService = new OutgoingBackupBeforeTestService();
    this.fakeService = new OutgoingFakeDataService();
    this.auditService = new OutgoingToAuditTestService();
  }

  async initialize() {
    await this.backupService.initialize();
    await this.fakeService.initialize();
    await this.auditService.initialize();
  }

  async run() {
    logger.info('=== START FULL TEST OUTGOING PROCESS ===');
    const results = {};

    // 1. Backup Outgoing Documents
    logger.info('>>> STEP 1: Backup Outgoing Documents');
    results.backup = await this.backupService.backup();

    // 2. Fake Data
    logger.info('>>> STEP 2: Fake Outgoing Data');
    const fakePayload = {
      senderUnit: "6915f2387e39c2ba33cef79a",
      drafter: "6915f2387e39c2ba33cef79a"
    };
    results.fakeData = await this.fakeService.fake(fakePayload);

    // 3. Create Audit
    logger.info('>>> STEP 3: Create Audit Records');
    const auditPayload = {
      user_id: "USER_TEST_01",
      role: "VAN_THU",
      action_code: "CREATE",
      receiver: "USER_TEST_01",
      receiver_unit: "DON_VI_TEST",
      roleProcess: "PROCESS_TEST",
      action: "CREATE",
      stage_status: "DRAFT"
    };
    results.audit = await this.auditService.createAudit(auditPayload);

    logger.info('=== FINISH FULL TEST OUTGOING PROCESS ===');
    return {
      success: true,
      steps: results,
      timestamp: new Date()
    };
  }
}

module.exports = FullTestOutgoingService;
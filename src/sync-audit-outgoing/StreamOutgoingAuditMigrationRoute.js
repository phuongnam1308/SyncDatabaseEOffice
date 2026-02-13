const express = require('express');
const router = express.Router();

const StreamOutgoingAuditSyncController =
  require('./StreamOutgoingAuditMigrationController');

router.post(
  '/sync/audit-outgoing-stream',
  StreamOutgoingAuditSyncController.run
);

const SyncAuditController = require('./SyncAuditController');
router.post('/audit/main', SyncAuditController.syncToMain);

module.exports = router;

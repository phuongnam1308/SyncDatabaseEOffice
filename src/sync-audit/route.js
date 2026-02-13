const express = require('express');
const router = express.Router();

const StreamAuditSyncController =
  require('./StreamAuditMigrationController');

router.post(
  '/migrate',
  StreamAuditSyncController.run
);

const SyncAuditController = require('./SyncAuditController');
router.post('/sync', SyncAuditController.syncToMain);

module.exports = router;

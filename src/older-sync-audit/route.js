const express = require('express');
const router = express.Router();

const StreamAuditSyncController =
  require('./migrate/StreamAuditMigrationController');

router.post(
  '/migrate',
  StreamAuditSyncController.run
);

const SyncAuditController = require('./apply/SyncAuditController');
router.post('/sync', SyncAuditController.syncToMain);

module.exports = router;

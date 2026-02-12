const express = require('express');
const router = express.Router();

const StreamOutgoingAuditSyncController =
  require('./StreamOutgoingAuditMigrationController');

router.post(
  '/sync/audit-outgoing-stream',
  StreamOutgoingAuditSyncController.run
);

module.exports = router;

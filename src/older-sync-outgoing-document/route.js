const express = require('express');
const router = express.Router();

const StreamOutgoingMigrationController =
  require('./migrate/StreamOutgoingMigrationController');

router.post('/migrate', StreamOutgoingMigrationController.runStreamMigration);

const SyncOutgoingController = require('./apply/SyncOutgoingController');
router.post('/sync', SyncOutgoingController.syncToMain);

module.exports = router;

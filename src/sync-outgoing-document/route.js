const express = require('express');
const router = express.Router();

const StreamOutgoingMigrationController =
  require('./StreamOutgoingMigrationController');

router.post('/migrate', StreamOutgoingMigrationController.runStreamMigration);

const SyncOutgoingController = require('./SyncOutgoingController');
router.post('/sync', SyncOutgoingController.syncToMain);

module.exports = router;

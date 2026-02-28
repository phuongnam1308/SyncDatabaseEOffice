const express = require('express');
const router = express.Router();

const StreamSocialMigrationController = require('./migrate/StreamSocialMigrationController');

router.post('/migrate/test-get-list', StreamSocialMigrationController.testGetList);
router.post('/migrate/test-process-one', StreamSocialMigrationController.testProcessOne);

module.exports = router;

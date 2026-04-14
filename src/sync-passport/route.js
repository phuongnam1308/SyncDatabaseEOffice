const express = require('express');
const router = express.Router();

const StreamPassportMigrationController = require('./migrate/StreamPassportMigrationController');

router.post('/migrate/test-get-list', StreamPassportMigrationController.testGetList);
router.post('/migrate/test-process-one', StreamPassportMigrationController.testProcessOne);

module.exports = router;

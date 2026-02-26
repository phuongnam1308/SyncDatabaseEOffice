const express = require('express');
const router = express.Router();

const StreamUserMigrationController = require('./migrate/StreamUserMigrationController');

router.post('/migrate/test-get-list', StreamUserMigrationController.testGetList);
router.post('/migrate/test-process-one', StreamUserMigrationController.testProcessOne);

module.exports = router;

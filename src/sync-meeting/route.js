const express = require('express');
const router = express.Router();

const StreamMeetingMigrationController = require('./migrate/StreamMeetingMigrationController');

router.post('/migrate/test-get-list', StreamMeetingMigrationController.testGetList);
router.post('/migrate/test-process-one', StreamMeetingMigrationController.testProcessOne);

module.exports = router;

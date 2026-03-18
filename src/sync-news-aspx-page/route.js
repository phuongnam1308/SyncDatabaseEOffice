const express = require('express');
const router = express.Router();

const StreamNewsAspxPageMigrationController = require('./controllers/StreamNewsAspxPageMigrationController');

router.post('/migrate/test-get-list', StreamNewsAspxPageMigrationController.testGetList);
router.post('/migrate/test-process-one', StreamNewsAspxPageMigrationController.testProcessOne);

module.exports = router;


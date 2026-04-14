const express = require('express');
const router = express.Router();

const StreamTaskMigrationController = require('./controllers/StreamTaskMigrationController');

/**
 * Task Sync Routes
 */
router.post('/migrate/test-get-list', StreamTaskMigrationController.testGetList);
router.post('/migrate/test-process-one', StreamTaskMigrationController.testProcessOne);
router.post('/migrate/process-all', StreamTaskMigrationController.processAll);
router.get('/migrate/sync-stats/:syncJobId', StreamTaskMigrationController.getSyncStats);
router.post('/migrate/reset/:syncJobId', StreamTaskMigrationController.resetSync);

module.exports = router;

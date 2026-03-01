const express = require('express');
const router = express.Router();

const StreamTaskMigrationController = require('./migrate/StreamTaskMigrationController');

router.post('/migrate/task-get-list', StreamTaskMigrationController.taskGetList);
router.post('/migrate/task-process-one', StreamTaskMigrationController.taskProcessOne);

module.exports = router;

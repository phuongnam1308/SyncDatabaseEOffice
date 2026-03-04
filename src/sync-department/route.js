const express = require('express');
const router = express.Router();

const StreamDepartmentMigrationController = require('./migrate/StreamDepartmentMigrationController');

router.post('/migrate/test-get-list', StreamDepartmentMigrationController.testGetList);
router.post('/migrate/test-process-one', StreamDepartmentMigrationController.testProcessOne);

module.exports = router;

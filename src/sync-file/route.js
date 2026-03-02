const express = require('express');
const router = express.Router();

const StreamFileMigrationController = require('./migrate/SteamfileMigrationController');
router.post('/migrate', StreamFileMigrationController.runStreamMigration);
router.get('/migrate/status', StreamFileMigrationController.getStatus);

const StreamFileDownloadTestController = require('./migrate/StreamFileDownloadTestController');
router.post('/test-download', StreamFileDownloadTestController.testDownloadByPath);
router.get('/test-download', StreamFileDownloadTestController.testDownloadByPath);

// const StreamFileMigrationController = require('./migrate/SteamfileMigrationController');
// router.post('/migrate', StreamFileMigrationController.runStreamMigration);
// router.get('/migrate/status', StreamFileMigrationController.getStatus);

// const SyncFileController = require('./apply/SyncFileController');
// router.post('/sync', SyncFileController.syncToMain);

module.exports = router;

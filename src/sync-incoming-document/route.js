const express = require('express');
const SyncIncomingDocumentController = require('./migrate/SyncIncomingDocumentController');
const router = express.Router();


router.post('/migrate/test-get-list', SyncIncomingDocumentController.testGetList);
router.post('/migrate/test-process-one', SyncIncomingDocumentController.testProcessOne);

module.exports = router;

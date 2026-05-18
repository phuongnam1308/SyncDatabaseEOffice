const express = require('express');
const router = express.Router();
const controller = require('./controllers/SharePointTaskController');

router.post('/process-all', controller.processAll.bind(controller));
router.get('/stats/:syncJobId', controller.getSyncStats.bind(controller));

module.exports = router;

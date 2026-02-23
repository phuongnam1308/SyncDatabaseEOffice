const express = require("express");
const router = express.Router();

const StreamCommentMigrationController = require("./migration/StreamCommentMigrationController");
const SyncCommentController = require("./apply/SyncCommentController");

router.post("/migrate", StreamCommentMigrationController.run);
router.post("/sync", SyncCommentController.syncToMain);
router.get("/sync/status", SyncCommentController.getStatus);

module.exports = router;

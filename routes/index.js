const express = require('express');
const router = express.Router();
require('dotenv').config();
const MigrationController = require('../controllers/MigrationOrganizationUnitsController');
const MigrationUserGroupController = require('../controllers/MigrationUserGroupController');

const MigrationUserInGroupController = require('../controllers/MigrationUserInGroupController');
const MappingController = require('../controllers/MappingController');
const MigrationDonViController = require('../controllers/MigrationDonViController');
const MigrationBookDocumentController = require('../controllers/MigrationBookDocumentController');
const MigrationBookDocumentDeleteController = require('../controllers/MigrationBookDocumentDeleteController');
const MigrationBookBanHanhController = require('../controllers/MigrationBookBanHanhController');
const MigrationBookBanHanhDeleteController = require('../controllers/MigrationBookBanHanhDeleteController');
const MigrationBookTotalStatisticsController = require('../controllers/MigrationBookTotalStatisticsController');
const MigrationAgencyController = require('../controllers/MigrationAgencyController');
const MigrationIncomingDocumentController = require('../controllers/MigrationIncomingDocumentController');
const MigrationIncomingDocumentDeleteController = require('../controllers/MigrationIncomingDocumentDeleteController');
const MigrationGroupController = require('../controllers/MigrationGroupController');
const MappingBookDocOutgoingController = require('../controllers/MappingBookDocOutgoingController');
const SenderUnitController = require('../controllers/SenderUnitController');// Health check
const DrafterMigrationController = require('../controllers/DrafterMigrationController');
const UpdateIncomingBookDocumentIdController =
  require('../controllers/updates/UpdateIncomingBookDocumentIdController');
const UpdateIncomingStatusCodeController =
  require('../controllers/updates/UpdateIncomingStatusCodeController');
const migrateIncomingDocs =
  require('../controllers/updates/MigrateIncomingDocumentsController');

const UpdateIncomingSenderUnitController =
  require('../controllers/UpdateIncomingSenderUnitController');
const MigrationTaskController = require('../controllers/MigrationTaskController');
const MigrationTaskDeleteController = require('../controllers/MigrationTaskDeleteController');
// Lấy thống kê migration
const MigrationTaskVBDiController = require('../controllers/MigrationTaskVBDiController');
const MigrationTaskUsers2Controller = require('../controllers/MigrationTaskUsers2Controller');

const MigrationTaskUsersVBDiController = require('../controllers/MigrationTaskUsersVBDiController');
const MigrationTaskUsersMappingController = require('../controllers/MigrationTaskUsersMappingController');
const TaskUsersTaskIdController = require('../controllers/TaskUsersTaskIdController');
const MigrationTaskUsers2ProcessController = require('../controllers/MigrationTaskUsers2ProcessController');
const TaskUsers2TypeSyncController =
  require('../controllers/TaskUsers2TypeSyncController');
const MigrationTaskUsers2ProcessOrgController =
  require('../controllers/MigrationTaskUsers2ProcessOrgController');
const MigrationTaskUsers2ProcessGroupController =
  require('../controllers/MigrationTaskUsers2ProcessGroupController');
const FileMigrationController =
  require('../controllers/FileMigrationController');
const IncomingFileMigrationController =
  require('../controllers/IncomingFileMigrationController');
router.get('/statistics', MigrationController.getStatistics);

// Thực hiện migration phòng ban - ĐỔI SANG GET ĐỂ DỄ TEST
router.get('/migrate/phongban', MigrationController.migratePhongBan);

router.get('/migrate/position', MigrationController.migratePosition);

// Thống kê UserGroup
router.get('/statistics/usergroup', MigrationUserGroupController.getStatistics);

// Migration UserGroup (nên dùng POST thực tế, nhưng để test dùng GET)
router.get('/migrate/usergroup', MigrationUserGroupController.migrateUserGroup);

// Thống kê UserInGroup
router.get('/statistics/useringroup', MigrationUserInGroupController.getStatistics);

// Migration UserInGroup
router.get('/migrate/useringroup', MigrationUserInGroupController.migrateUserInGroup);

// API mapping toàn bộ ID cũ → ID mới
router.get('/mapping/update-relations', MappingController.updateRelationsMapping);

// Thống kê DonVi
router.get('/statistics/donvi', MigrationDonViController.getStatistics);

// Migration DonVi (dùng GET để test)
router.get('/migrate/donvi', MigrationDonViController.migrateDonVi);

// Thống kê số văn bản
router.get('/statistics/bookdocuments', MigrationBookDocumentController.getStatistics);

// Migration số văn bản 
router.get('/migrate/bookdocuments', MigrationBookDocumentController.migrateBookDocuments);

// Thống kê Văn bản đến Delete
router.get('/statistics/bookdocumentsdelete', MigrationBookDocumentDeleteController.getStatistics);

// Migration Văn bản đến Delete (gộp theo Title, check duplicate name)
router.get('/migrate/bookdocumentsdelete', MigrationBookDocumentDeleteController.migrateBookDocumentsDelete);

// Thống kê Văn bản ban hành
router.get('/statistics/bookbanhanh', MigrationBookBanHanhController.getStatistics);

// Migration Văn bản ban hành (gộp theo SoVanBan, check duplicate to_book_code)
router.get('/migrate/bookbanhanh', MigrationBookBanHanhController.migrateBookBanHanh);

// Thống kê Văn bản ban hành Delete
router.get('/statistics/bookbanhanhdelete', MigrationBookBanHanhDeleteController.getStatistics);

// Migration Văn bản ban hành Delete (gộp theo SoVanBan, check duplicate to_book_code)
router.get('/migrate/bookbanhanhdelete', MigrationBookBanHanhDeleteController.migrateBookBanHanhDelete);

// Thống kê tổng quát 4 nguồn sổ văn bản
router.get('/statistics/book-total', MigrationBookTotalStatisticsController.getTotalStatistics);

// Thống kê Đơn vị
router.get('/statistics/agencies', MigrationAgencyController.getStatistics);

// Migration Đơn vị
router.get('/migrate/agencies', MigrationAgencyController.migrateAgencies);

// Thống kê Văn bản đến
router.get('/statistics/incomingdocuments', MigrationIncomingDocumentController.getStatistics);

// Migration Văn bản đến
router.get('/migrate/incomingdocuments', MigrationIncomingDocumentController.migrateIncomingDocuments);

// const MigrationIncomingDocumentController =
//   require('../controllers/MigrationIncomingDocumentController');

// router.post(
//   '/migrate/incoming2-to-incoming',
//   MigrationIncomingDocumentController.migrate
// );



// Thống kê Văn bản đến Delete
router.get('/statistics/incomingdocumentsdelete', MigrationIncomingDocumentDeleteController.getStatistics);

// Migration Văn bản đến Delete
router.get('/migrate/incomingdocumentsdelete', MigrationIncomingDocumentDeleteController.migrateIncomingDocumentsDelete);

// Thống kê Group
router.get('/statistics/group', MigrationGroupController.getStatistics);

// Migration Group
router.get('/migrate/group', MigrationGroupController.migrateGroups);
router.get('/mapping/bookdoc-outgoing', MappingBookDocOutgoingController.mapBookDocToOutgoing);
router.get('/statistics/mapping-bookdoc-outgoing', MappingBookDocOutgoingController.getMappingStats);

// API sender_unit
router.get('/statistics/sender-unit', SenderUnitController.getSenderUnitStatistics);
router.get('/sender-unit/test', SenderUnitController.testMapping);
router.get('/migrate/sender-unit', SenderUnitController.updateSenderUnits);
router.get('/migrate/sender-unit/batch/:limit', SenderUnitController.updateSenderUnitsBatch);
router.get('/sender-unit/update/:id', SenderUnitController.updateSingleSenderUnit);
router.get('/statistics/drafter-preview', DrafterMigrationController.preview);
router.get('/migrate/drafter', DrafterMigrationController.migrate);
router.get('/update/incoming-book-document-id', UpdateIncomingBookDocumentIdController.update);
router.get(
  '/update/incoming-status-code',
  UpdateIncomingStatusCodeController.update
);

router.get(
  '/update/incoming-sender-unit',
  UpdateIncomingSenderUnitController.update
);

router.get(
  '/migrate/incoming-documents',
  migrateIncomingDocs.migrate
);
const IncomingDocumentSyncController = require('../controllers/IncomingDocumentSyncController');
router.get('/sync/incoming-documents', IncomingDocumentSyncController.sync);
router.get('/statistics/incoming-sync-status', IncomingDocumentSyncController.status);

router.get('/statistics/task', MigrationTaskController.getStatistics);
router.get('/statistics/task-delete', MigrationTaskDeleteController.getStatistics);
// Migration Task (dùng GET để test dễ dàng)
router.get('/migrate/task-vbden', MigrationTaskController.migrateTaskRecords);
router.get('/migrate/task-vbdendelete', MigrationTaskDeleteController.migrateTaskDeleteRecords);
// Router thêm
router.get('/statistics/task-vbdi', MigrationTaskVBDiController.getStatistics);
router.get('/migrate/task-vbdi', MigrationTaskVBDiController.migrateTaskVBDiRecords);
// Thống kê task_users2
router.get('/statistics/task-users2', MigrationTaskUsers2Controller.getStatistics);

// Thực hiện migration task_users2
router.get('/migrate/task-users2', MigrationTaskUsers2Controller.migrate);
// Thống kê & migrate TaskVBDiPermission → task_users2
router.get('/statistics/task-users-vbdi', MigrationTaskUsersVBDiController.getStatistics);
router.get('/migrate/task-users-vbdi', MigrationTaskUsersVBDiController.migrate);
router.get('/statistics/task-users-taskid', TaskUsersTaskIdController.statistics);

// Chạy update mapping task_id (gán task2.id vào task_users2.task_id)
router.get('/update/task-users-taskid', TaskUsersTaskIdController.update);

// (Tùy chọn) Nếu bạn muốn dùng POST để an toàn hơn, có thể thay bằng:
router.get('/update/task-users-taskid', TaskUsersTaskIdController.update); router.get('/update/task-users-taskid', MigrationTaskUsersMappingController.updateMapping);
router.get(
  '/mapping/task-users2-process',
  MigrationTaskUsers2ProcessController.mapProcess
);
router.get(
  '/sync/task-users2-type',
  TaskUsers2TypeSyncController.sync
);
router.get(
  '/mapping/task-users2-process-org',
  MigrationTaskUsers2ProcessOrgController.map
);
router.get(
  '/mapping/task-users2-process-group',
  MigrationTaskUsers2ProcessGroupController.map
);

router.get('/migrate/files-vanbanbanhanh',
  FileMigrationController.migrate
);
router.get('/migrate/files-vbden', IncomingFileMigrationController.migrate);

// Thêm vào index.js

// Thêm vào index.js (cuối phần router definitions, trước module.exports = router;)
// Import controller mới
const UpdateFiles2NameController = require('../controllers/UpdateFiles2NameController');

// Thêm routes
router.get('/statistics/files2-name-update', UpdateFiles2NameController.getStatistics);
router.get('/update/files2-name-from-path', UpdateFiles2NameController.update);


const MigrationFileRelationsController = require('../controllers/MigrationFileRelationsController');
router.get('/statistics/file-relations', MigrationFileRelationsController.getStatistics);
router.get('/migrate/file-relations', MigrationFileRelationsController.migrateFileRelations);


const FileRelationsMappingController = require('../controllers/FileRelationsMappingController');

router.get(
  '/migrate/file-relations/object-type',
  FileRelationsMappingController.mappingObjectType
);

const FileRelationTypeResolverController =
  require('../controllers/FileRelationTypeResolverController');

router.get(
  '/resolve/file-relations-object-type',
  FileRelationTypeResolverController.resolve
);

const FileRelations2ToMainController =
  require('../controllers/FileRelations2ToMainController');

router.get(
  '/migration/file-relations2-to-main',
  FileRelations2ToMainController.migrate
);

router.get(
  '/migration/file-relations2-to-main/statistics',
  FileRelations2ToMainController.statistics
);

const IncommingBpmnVersionTestController =
  require('../controllers/tests/IncommingBpmnVersionTestController');

router.post(
  '/test/incomming/update-bpmn-version',
  IncommingBpmnVersionTestController.update
);


const IncommingBackupBeforeTestController =
  require('../controllers/tests/IncommingBackupBeforeTestController');

router.get(
  '/test/incomming/backup-before-test',
  IncommingBackupBeforeTestController.backup
);

const IncommingBulkUpdateTestController =
  require('../controllers/tests/IncommingBulkUpdateTestController');

router.post(
  '/test/incomming/bulk-update',
  IncommingBulkUpdateTestController.update
);

const IncommingAuditCreateController =
  require('../controllers/tests/IncommingAuditCreateController');

router.post(
  '/test/incomming/create-audit',
  IncommingAuditCreateController.create
);

const MigrationTask3ToTaskController = require('../controllers/MigrationTask3ToTaskController');
// Task3 to Task migration routes
router.get('/migrate/task3toTask', MigrationTask3ToTaskController.migrateTaskRecords);
router.get('/migrate/task3toTask/stats', MigrationTask3ToTaskController.getStatistics);

// Add similar for other migrations if any
const MigrationTask2ToTaskController = require('../controllers/MigrationTask2ToTaskController');
// Task2 to Task migration routes
router.get('/migrate/task2toTask', MigrationTask2ToTaskController.migrateTaskRecords);
router.get('/migrate/task2toTask/stats', MigrationTask2ToTaskController.getStatistics);

const MigrationTaskUsers2ToTaskUsersController =
  require('../controllers/MigrationTaskUsers2ToTaskUsersController');

router.get(
  '/migrate/task-users2-to-task-users',
  MigrationTaskUsers2ToTaskUsersController.migrate
);

router.get(
  '/migrate/task-users2-to-task-users/stats',
  MigrationTaskUsers2ToTaskUsersController.statistics
);

const TaskAuditTestController =
  require('../controllers/tests/TaskAuditTestController');

router.post(
  '/test/create-task-audit',
  TaskAuditTestController.create
);


const OutgoingRoutes = require('../src/older-sync-outgoing-document/route');
router.use('/outgoing', OutgoingRoutes);

const AuditRoutes = require('../src/older-sync-audit/route');
router.use('/audit', AuditRoutes);

const UserRoutes = require('../src/sync-user/route');
router.use('/user', UserRoutes);

const UserCopyRoutes = require('../src/sync-user-copy/route');
router.use('/user-copy', UserCopyRoutes);

const SocialResourceRoutes = require('../src/sync-social-resource/route');
router.use('/sync-social-resource', SocialResourceRoutes);

const FileRoutes = require('../src/sync-file/route');
router.use('/file', FileRoutes);

const incommingRoutes = require('../src/sync-incoming-document/route');
router.use('/incoming', incommingRoutes);


module.exports = router;
const SrcSyncManagerController = require('../src/sync-manager/SyncManagerController');
router.get('/sync-manager-src/dashboard', SrcSyncManagerController.getDashboard);
router.post('/sync-manager-src/start', SrcSyncManagerController.startSync);
router.post('/sync-manager-src/models/:modelName/start', SrcSyncManagerController.startModelSync);
router.post('/sync-manager-src/jobs/:jobId/pause', SrcSyncManagerController.pauseJobSync);
router.post('/sync-manager-src/jobs/:jobId/resume', SrcSyncManagerController.resumeJobSync);
router.get('/sync-manager-src/jobs/:jobId', SrcSyncManagerController.getJobSyncStatus);
router.get('/sync-manager-src/events', SrcSyncManagerController.sseEvents); // ← THÊM DÒNG NÀY


const SyncOutgoingRoutes = require('../src/sync-outgoing-document/route');
router.use('/sync-outgoing', SyncOutgoingRoutes);

const CommentRoutes = require('../src/older-sync-document-comment/route');
router.use('/document-comments', CommentRoutes);

const TaskCopyRoutes = require('../src/sync-tasks/route');
router.use('/sync-tasks', TaskCopyRoutes);

module.exports = router;

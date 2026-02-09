const express = require('express');
const router = express.Router();
require('dotenv').config();
const MigrationController = require('../controllers/MigrationOrganizationUnitsController');
const MigrationUserGroupController = require('../controllers/MigrationUserGroupController');
const MigrationUserController = require('../controllers/MigrationUserController');
const MigrationUserDeleteController = require('../controllers/MigrationUserDeleteController');
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
const MigrationOutgoingDocumentController = require('../controllers/MigrationOutgoingDocumentController');
const MigrationOutgoingDocumentDeleteController = require('../controllers/MigrationOutgoingDocumentDeleteController');
const MigrationGroupController = require('../controllers/MigrationGroupController');
const FormatOutgoing2Controller = require('../controllers/FormatOutgoing2Controller');
const MappingBookDocOutgoingController = require('../controllers/MappingBookDocOutgoingController');
const SenderUnitController = require('../controllers/SenderUnitController');// Health check
const DrafterMigrationController = require('../controllers/DrafterMigrationController');
const SyncOutgoingController = require('../controllers/SyncOutgoingController');
const UpdateIncomingBookDocumentIdController =
  require('../controllers/updates/UpdateIncomingBookDocumentIdController');
const UpdateIncomingStatusCodeController =
  require('../controllers/updates/UpdateIncomingStatusCodeController');
  const migrateIncomingDocs =
  require('../controllers/updates/MigrateIncomingDocumentsController');
const MigrationAuditController = require('../controllers/MigrationAuditController');
const MigrationAuditLuanchuyenATPCController =
  require('../controllers/MigrationAuditLuanchuyenATPCController');
  router.get('/health', MigrationController.healthCheck);
const MigrationAuditLuanchuyenCLLController =
  require('../controllers/MigrationAuditLuanchuyenCLLController');
const MigrationAuditLuanchuyenCNTTController =
  require('../controllers/MigrationAuditLuanchuyenCNTTController');
const MigrationAuditLuanchuyenCTController =
  require('../controllers/MigrationAuditLuanchuyenCTController');
 const MigrationAuditLuanchuyenCVTCController =
  require('../controllers/MigrationAuditLuanchuyenCVTCController');
 const MigrationAuditLuanchuyenDonViController =
  require('../controllers/MigrationAuditLuanchuyenDonViController');
 const MigrationAuditLuanchuyenDVHHController =
  require('../controllers/MigrationAuditLuanchuyenDVHHController');
 const MigrationAuditLuanchuyenDVKTController =
  require('../controllers/MigrationAuditLuanchuyenDVKTController');
  // Kiểm tra kết nối database
  const MigrationAuditLuanchuyenGNVTController =
  require('../controllers/MigrationAuditLuanchuyenGNVTController');
const MigrationAuditLuanchuyenHCController = require('../controllers/MigrationAuditLuanchuyenHCController');
  router.get('/check-connection', MigrationController.checkConnection);
const MigrationAuditLuanchuyenHTController =
  require('../controllers/MigrationAuditLuanchuyenHTController');
const MigrationAuditLuanchuyenICDLBController =
  require('../controllers/MigrationAuditLuanchuyenICDLBController');
const MigrationAuditLuanchuyenICDSTController =
  require('../controllers/MigrationAuditLuanchuyenICDSTController');
const MigrationAuditLuanchuyenKHDTController =
  require('../controllers/MigrationAuditLuanchuyenKHDTController');
const MigrationAuditLuanchuyenKHKDController =
  require('../controllers/MigrationAuditLuanchuyenKHKDController');
const MigrationAuditLuanchuyenNPLController =
  require('../controllers/MigrationAuditLuanchuyenNPLController');
// const SyncIncomingController = require('../controllers/SyncIncomingController');
const IncomingDocumentSyncController = require('../controllers/IncomingDocumentSyncController');
const AuditActionCodeController =
  require('../controllers/AuditActionCode.controller');
const Audit2MappingUserIdController =
  require('../controllers/Audit2MappingUserIdController');
const UpdateIncomingSenderUnitController =
  require('../controllers/UpdateIncomingSenderUnitController');
  const Audit2SyncTypeDocumentController =
  require('../controllers/Audit2SyncTypeDocumentController');
const Audit2RoleProcessSyncController =
  require('../controllers/Audit2RoleProcessSyncController');
const SyncAuditOutgoingController = require('../controllers/SyncAuditOutgoingController');
const SyncAuditIncomingController = require('../controllers/SyncAuditIncomingController');
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
const MigrationDocumentCommentsController =
  require('../controllers/MigrationDocumentCommentsController');
const DocumentCommentsReplySyncController =
  require('../controllers/DocumentCommentsReplySyncController');
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

// Thống kê User
router.get('/statistics/user', MigrationUserController.getStatistics);

// Migration User (nên dùng POST thực tế, nhưng để test dùng GET)
router.get('/migrate/user', MigrationUserController.migrateUser);

// Thống kê UserDelete (thêm mới)
router.get('/statistics/userdelete', MigrationUserDeleteController.getStatistics);

// Migration UserDelete (nên dùng POST thực tế, nhưng để test dùng GET) (thêm mới)
router.get('/migrate/userdelete', MigrationUserDeleteController.migrateUserDelete);

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

// Thống kê Văn bản ban hành
router.get('/statistics/outgoingdocuments2', MigrationOutgoingDocumentController.getStatistics);

// Migration Văn bản ban hành
router.get('/migrate/outgoingdocuments2', MigrationOutgoingDocumentController.migrateOutgoingDocuments);

// Thống kê Văn bản ban hành Delete
router.get('/statistics/outgoingdocumentsdelete', MigrationOutgoingDocumentDeleteController.getStatistics);

// Migration Văn bản ban hành Delete
router.get('/migrate/outgoingdocumentsdelete', MigrationOutgoingDocumentDeleteController.migrateOutgoingDocumentsDelete);

// Test kết nối Group
router.get('/test/group', MigrationGroupController.testConnection);

// Thống kê Group
router.get('/statistics/group', MigrationGroupController.getStatistics);

// Migration Group
router.get('/migrate/group', MigrationGroupController.migrateGroups);

router.get('/format/outgoing2', FormatOutgoing2Controller.formatOutgoing2);
router.get('/statistics/outgoing2-format', FormatOutgoing2Controller.getFormatStatistics);
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
router.get('/statistics/sync-outgoing', SyncOutgoingController.preview);
router.get('/sync/outgoing', SyncOutgoingController.sync);
router.get(
  '/update/incoming-book-document-id',
  UpdateIncomingBookDocumentIdController.update
);
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

// Thống kê Audit2
router.get('/statistics/audit', MigrationAuditController.getStatistics);

// Migration Audit2 (dùng GET để test dễ dàng)
router.get('/migrate/audit', MigrationAuditController.migrateAuditRecords);

router.get(
  '/migrate/audit3-luanchuyen-atpc',
  MigrationAuditLuanchuyenATPCController.migrate
);
router.get(
  '/migrate/audit3-luanchuyen-cll',
  MigrationAuditLuanchuyenCLLController.migrate
);

router.get(
  '/migrate/audit3-luanchuyen-cntt',
  MigrationAuditLuanchuyenCNTTController.migrate
);
router.get(
  '/migrate/audit3-luanchuyen-ct',
  MigrationAuditLuanchuyenCTController.migrate
);
router.get(
  '/migrate/audit3-luanchuyen-cvtc',
  MigrationAuditLuanchuyenCVTCController.migrate
);

router.get(
  '/migrate/audit3-luanchuyen-donvi',
  MigrationAuditLuanchuyenDonViController.migrate
);

router.get(
  '/migrate/audit3-luanchuyen-dvhh',
  MigrationAuditLuanchuyenDVHHController.migrate
);

router.get(
  '/migrate/audit3-luanchuyen-dvkt',
  MigrationAuditLuanchuyenDVKTController.migrate
);

router.get(
  '/migrate/audit3-luanchuyen-gnvt',
  MigrationAuditLuanchuyenGNVTController.migrate
);
router.get(
  '/migrate/audit3-luanchuyen-hc',
  MigrationAuditLuanchuyenHCController.migrate
);
router.get(
  '/migrate/audit3-luanchuyen-ht',
  MigrationAuditLuanchuyenHTController.migrate
);

router.get(
  '/migrate/audit3-luanchuyen-icdlb',
  MigrationAuditLuanchuyenICDLBController.migrate
);

router.get(
  '/migrate/audit3-luanchuyen-icdst',
  MigrationAuditLuanchuyenICDSTController.migrate
);
router.get(
  '/migrate/audit3-luanchuyen-khdt',
  MigrationAuditLuanchuyenKHDTController.migrate
);
router.get(
  '/migrate/audit3-luanchuyen-khkd',
  MigrationAuditLuanchuyenKHKDController.migrate
);

router.get(
  '/migrate/audit3-luanchuyen-npl',
  MigrationAuditLuanchuyenNPLController.migrate
);


const MigrationAuditLuanchuyenKVTCController =
  require('../controllers/MigrationAuditLuanchuyenKVTCController');
router.get(
  '/migrate/audit3-luanchuyen-kvtc',
  MigrationAuditLuanchuyenKVTCController.migrate
);



const MigrationAuditLuanchuyenXNCGController =
  require('../controllers/MigrationAuditLuanchuyenXNCGController');
router.get(
  '/migrate/audit3-luanchuyen-XNCG',
  MigrationAuditLuanchuyenXNCGController.migrate
);

const MigrationAuditLuanchuyenMKTController =
  require('../controllers/MigrationAuditLuanchuyenMKTController');
router.get(
  '/migrate/audit3-luanchuyen-MKT',
  MigrationAuditLuanchuyenMKTController.migrate
);

const MigrationAuditLuanchuyenQLCTController =
  require('../controllers/MigrationAuditLuanchuyenQLCTController');
router.get(
  '/migrate/audit3-luanchuyen-QLCT',
  MigrationAuditLuanchuyenQLCTController.migrate
);

const MigrationAuditLuanchuyenQSBVController =
  require('../controllers/MigrationAuditLuanchuyenQSBVController');
router.get(
  '/migrate/audit3-luanchuyen-QSBV',
  MigrationAuditLuanchuyenQSBVController.migrate
);


const MigrationAuditLuanchuyenSNPLController =
  require('../controllers/MigrationAuditLuanchuyenSNPLController');
router.get(
  '/migrate/audit3-luanchuyen-SNPL',
  MigrationAuditLuanchuyenSNPLController.migrate
);

const MigrationAuditLuanchuyenTCController =
  require('../controllers/MigrationAuditLuanchuyenTCController');
router.get(
  '/migrate/audit3-luanchuyen-TC',
  MigrationAuditLuanchuyenTCController.migrate
);

const MigrationAuditLuanchuyenTC189Controller =
  require('../controllers/MigrationAuditLuanchuyenTC189Controller');
router.get(
  '/migrate/audit3-luanchuyen-TC189',
  MigrationAuditLuanchuyenTC189Controller.migrate
);

const MigrationAuditLuanchuyenTCCTController =
  require('../controllers/MigrationAuditLuanchuyenTCCTController');
router.get(
  '/migrate/audit3-luanchuyen-TCCT',
  MigrationAuditLuanchuyenTCCTController.migrate
);

const MigrationAuditLuanchuyenTCHPController =
  require('../controllers/MigrationAuditLuanchuyenTCHPController');
router.get(
  '/migrate/audit3-luanchuyen-TCHP',
  MigrationAuditLuanchuyenTCHPController.migrate
);

const MigrationAuditLuanchuyenTCIDIController =
  require('../controllers/MigrationAuditLuanchuyenTCIDIController');
router.get(
  '/migrate/audit3-luanchuyen-TCIDI',
  MigrationAuditLuanchuyenTCIDIController.migrate
);

const MigrationAuditLuanchuyenTCLDController =
  require('../controllers/MigrationAuditLuanchuyenTCLDController');
router.get(
  '/migrate/audit3-luanchuyen-TCLD',
  MigrationAuditLuanchuyenTCLDController.migrate
);


const MigrationAuditLuanchuyenTCMTController =
  require('../controllers/MigrationAuditLuanchuyenTCMTController');
router.get(
  '/migrate/audit3-luanchuyen-TCMT',
  MigrationAuditLuanchuyenTCMTController.migrate
);

const MigrationAuditLuanchuyenTCOController =
  require('../controllers/MigrationAuditLuanchuyenTCOController');
router.get(
  '/migrate/audit3-luanchuyen-TCO',
  MigrationAuditLuanchuyenTCOController.migrate
);

const MigrationAuditLuanchuyenTCOTController =
  require('../controllers/MigrationAuditLuanchuyenTCOTController');
router.get(
  '/migrate/audit3-luanchuyen-TCOT',
  MigrationAuditLuanchuyenTCOTController.migrate
);

const MigrationAuditLuanchuyenTCPCController =
  require('../controllers/MigrationAuditLuanchuyenTCPCController');
router.get(
  '/migrate/audit3-luanchuyen-TCPC',
  MigrationAuditLuanchuyenTCPCController.migrate
);

const MigrationAuditLuanchuyenTCPHController =
  require('../controllers/MigrationAuditLuanchuyenTCPHController');
router.get(
  '/migrate/audit3-luanchuyen-TCPH',
  MigrationAuditLuanchuyenTCPHController.migrate
);

const MigrationAuditLuanchuyenTCTTController =
  require('../controllers/MigrationAuditLuanchuyenTCTTController');
router.get(
  '/migrate/audit3-luanchuyen-TCTT',
  MigrationAuditLuanchuyenTCTTController.migrate
);


const MigrationAuditLuanchuyenTDDCController =
  require('../controllers/MigrationAuditLuanchuyenTDDCController');
router.get(
  '/migrate/audit3-luanchuyen-TDDC',
  MigrationAuditLuanchuyenTDDCController.migrate
);


const MigrationAuditLuanchuyenTTDTCController =
  require('../controllers/MigrationAuditLuanchuyenTTDTCController');
router.get(
  '/migrate/audit3-luanchuyen-TTDTC',
  MigrationAuditLuanchuyenTTDTCController.migrate
);


const MigrationAuditLuanchuyenVPController =
  require('../controllers/MigrationAuditLuanchuyenVPController');
router.get(
  '/migrate/audit3-luanchuyen-VP',
  MigrationAuditLuanchuyenVPController.migrate
);

const MigrationAuditLuanchuyenVPMBController =
  require('../controllers/MigrationAuditLuanchuyenVPMBController');
router.get(
  '/migrate/audit3-luanchuyen-VPMB',
  MigrationAuditLuanchuyenVPMBController.migrate
);


const MigrationAuditLuanchuyenVPTNBController =
  require('../controllers/MigrationAuditLuanchuyenVPTNBController');
router.get(
  '/migrate/audit3-luanchuyen-VPTNB',
  MigrationAuditLuanchuyenVPTNBController.migrate
);

const MigrationAuditLuanchuyenVTBController =
  require('../controllers/MigrationAuditLuanchuyenVTBController');
router.get(
  '/migrate/audit3-luanchuyen-VTB',
  MigrationAuditLuanchuyenVTBController.migrate
);

const MigrationAuditLuanchuyenVTTController =
  require('../controllers/MigrationAuditLuanchuyenVTTController');
router.get(
  '/migrate/audit3-luanchuyen-VTT',
  MigrationAuditLuanchuyenVTTController.migrate
);

const MigrationAuditLuanchuyenXDCTController =
  require('../controllers/MigrationAuditLuanchuyenXDCTController');
router.get(
  '/migrate/audit3-luanchuyen-XDCT',
  MigrationAuditLuanchuyenXDCTController.migrate
);

const MigrationAuditLuanchuyenxdsmController =
  require('../controllers/MigrationAuditLuanchuyenxdsmController');
router.get(
  '/migrate/audit3-luanchuyen-xdsm',
  MigrationAuditLuanchuyenxdsmController.migrate
);

const MigrationAuditLuanchuyenYTEController =
  require('../controllers/MigrationAuditLuanchuyenYTEController');
router.get(
  '/migrate/audit3-luanchuyen-YTE',
  MigrationAuditLuanchuyenYTEController.migrate
);

const MigrationAuditLuanchuyenCBQLController =
  require('../controllers/MigrationAuditLuanchuyenCBQLController');
router.get(
  '/migrate/audit3-luanchuyen-CBQL',
  MigrationAuditLuanchuyenCBQLController.migrate
);


router.get('/sync/incoming-documents', IncomingDocumentSyncController.sync);
router.get('/statistics/incoming-sync-status', IncomingDocumentSyncController.status);

router.get('/audit2/update-action-code', AuditActionCodeController.run);
// Mapping user_id cho Audit2 (bảng mới – chạy độc lập)
router.get(
  '/mapping/audit2-user',
  Audit2MappingUserIdController.mapUserId
);

// Đồng bộ type_document cho audit2
router.get(
  '/sync/audit2-type-document',
  Audit2SyncTypeDocumentController.sync
);

router.get(
  '/audit2/sync-role-process',
  Audit2RoleProcessSyncController.sync
);
router.get('/sync/audit-outgoing', SyncAuditOutgoingController.sync);

// Thêm vào index.js (cuối phần router definitions, trước module.exports = router;)
// Thống kê Task
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
router.get('/update/task-users-taskid', TaskUsersTaskIdController.update);router.get('/update/task-users-taskid', MigrationTaskUsersMappingController.updateMapping);
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

router.get(
  '/migration/document-comments',
  MigrationDocumentCommentsController.migrate
);

const MigrationDocumentCommentsControllerATPC =
  require('../controllers/MigrationDocumentCommentsControllerATPC');
router.get(
  '/migration/document-commentsATPC',
  MigrationDocumentCommentsControllerATPC.migrate
);


router.get(
  '/sync/document-comments-reply',
  DocumentCommentsReplySyncController.sync
);

router.get(
  '/migrate/files-vanbanbanhanh',
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


const OutgoingBpmnVersionSyncController =
  require('../controllers/updates/OutgoingBpmnVersionSyncController');

router.get(
  '/sync/outgoing-bpmn-version',
  OutgoingBpmnVersionSyncController.sync
);

const OutgoingSenderUnitSyncController =
  require('../controllers/updates/OutgoingSenderUnitSyncController');

router.get(
  '/sync/outgoing-sender-unit',
  OutgoingSenderUnitSyncController.sync
);

const OutgoingBackupBeforeTestController =
  require('../controllers/tests/OutgoingBackupBeforeTestController');

router.get(
  '/test/backup-outgoing-before-status-test',
  OutgoingBackupBeforeTestController.backup
);

const OutgoingFakeDataController =
  require('../controllers/tests/OutgoingFakeDataController');

router.post(
  '/test/fake-outgoing-data',
  OutgoingFakeDataController.fake
);

const OutgoingToAuditTestController =
  require('../controllers/tests/OutgoingToAuditTestController');

router.post(
  '/test/outgoing-to-audit',
  OutgoingToAuditTestController.create
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

const SyncManagerController = require('../controllers/SyncManagerController');
router.get('/sync-manager/dashboard', SyncManagerController.getDashboard);
router.post('/sync-manager/start', SyncManagerController.startSync);
router.post('/sync-manager/stop', SyncManagerController.stopSync);
router.post('/sync-manager/sync-model/:modelName', SyncManagerController.syncModel);
router.get('/sync-manager/model-details/:modelName', SyncManagerController.modelDetails);
router.get('/sync-manager/errors/:modelName', SyncManagerController.getErrors);
router.get('/sync-manager/errors/:modelName/export', SyncManagerController.exportErrors);

const FullOutgoingMigrationController = require('../controllers/FullOutgoingMigrationController');
router.get('/migrate/full-outgoing-process', FullOutgoingMigrationController.runFullProcess);


module.exports = router;
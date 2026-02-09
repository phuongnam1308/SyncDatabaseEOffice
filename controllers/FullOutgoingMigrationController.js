const BaseController = require('./BaseController');
const logger = require('../utils/logger');

// Import tất cả các service cần thiết
const MigrationOutgoingDocumentService = require('../services/MigrationOutgoingDocumentService');
const FormatOutgoing2Service = require('../services/FormatOutgoing2Service');
const OutgoingDocument2Model = require('../models/OutgoingDocument2Model');
const DrafterMigrationService = require('../services/DrafterMigrationService');
const MappingBookDocOutgoingService = require('../services/MappingBookDocOutgoingService');
const OutgoingSenderUnitSyncService = require('../services/OutgoingSenderUnitSyncService');
const OutgoingBpmnVersionSyncService = require('../services/OutgoingBpmnVersionSyncService');

class FullOutgoingMigrationController extends BaseController {
  
  /**
   * @swagger
   * /migrate/full-outgoing-process:
   *   get:
   *     summary: Chạy toàn bộ quy trình đồng bộ văn bản đi (6 bước)
   *     tags: [Dong bo van ban di]
   */
  runFullProcess = this.asyncHandler(async (req, res) => {
    const results = {};
    const startTime = Date.now();
    logger.info('🚀 BẮT ĐẦU QUY TRÌNH FULL MIGRATION VĂN BẢN ĐI');

    try {
      // BƯỚC 1: Migrate dữ liệu thô (SQL cũ -> outgoing_documents2)
      logger.info('--- STEP 1: Migrate Outgoing Documents ---');
      const migrationService = new MigrationOutgoingDocumentService();
      await migrationService.initialize();
      results.step1_migration = await migrationService.migrateOutgoingDocuments();

      // BƯỚC 2: Format & Clean dữ liệu
      logger.info('--- STEP 2: Format Outgoing Documents ---');
      const formatService = new FormatOutgoing2Service();
      await formatService.initialize();
      results.step2_format = await formatService.runFormat();

      // BƯỚC 3: Map người soạn thảo (Drafter)
      logger.info('--- STEP 3: Migrate Drafter ---');
      const odModel = new OutgoingDocument2Model();
      await odModel.initialize();
      const drafterService = new DrafterMigrationService(odModel);
      results.step3_drafter = await drafterService.migrate();

      // BƯỚC 4: Map sổ văn bản (Book Document)
      logger.info('--- STEP 4: Map Book Document ---');
      const bookService = new MappingBookDocOutgoingService();
      await bookService.initialize();
      results.step4_bookMapping = await bookService.mapBookDocumentIds();

      // BƯỚC 5: Map đơn vị gửi (Sender Unit)
      logger.info('--- STEP 5: Sync Sender Unit ---');
      const senderService = new OutgoingSenderUnitSyncService();
      await senderService.initialize();
      results.step5_senderUnit = await senderService.sync();

      // BƯỚC 6: Cập nhật BPMN Version
      logger.info('--- STEP 6: Sync BPMN Version ---');
      const bpmnService = new OutgoingBpmnVersionSyncService();
      await bpmnService.initialize();
      results.step6_bpmn = await bpmnService.sync();

      const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
      results.totalDuration = `${totalDuration}s`;

      logger.info('✅ QUY TRÌNH FULL MIGRATION HOÀN TẤT');
      
      return this.success(res, results, 'Toàn bộ quy trình đồng bộ văn bản đi hoàn tất thành công');

    } catch (error) {
      logger.error('❌ Lỗi trong quy trình full migration:', error);
      return this.error(res, 'Quy trình bị lỗi giữa chừng', 500, {
        message: error.message,
        stack: error.stack,
        partialResults: results
      });
    }
  });
}

module.exports = new FullOutgoingMigrationController();

// services/MigrationSharePointGroupService.js - ĐƠN GIẢN
const SharePointGroupModel = require('../models/SharePointGroupModel');
const { tableMappings } = require('../config/tablesSharePointGroup');
const { mapFieldValues, chunkArray, formatNumber } = require('../utils/helpers');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class MigrationSharePointGroupService {
  constructor() {
    this.model = new SharePointGroupModel();
    this.batchSize = 100;
    this.config = tableMappings.sharepointgroup;
  }

  async initialize() {
    try {
      await this.model.initialize();
      logger.info('✅ Service Group migration đã khởi tạo');
    } catch (error) {
      logger.error('❌ Lỗi khởi tạo service:', error);
      throw error;
    }
  }

  generateGuid() {
    return uuidv4().toUpperCase();
  }

  async migrateGroups() {
    const startTime = Date.now();
    logger.info('🚀 === BẮT ĐẦU MIGRATION GROUP ===');

    try {
      const totalRecords = await this.model.countOldDb();
      logger.info(`📊 Tổng records: ${formatNumber(totalRecords)}`);

      if (totalRecords === 0) {
        logger.warn('⚠️ Không có dữ liệu');
        return { success: true, total: 0, inserted: 0, skipped: 0, errors: 0 };
      }

      const oldRecords = await this.model.getAllFromOldDb();
      const batches = chunkArray(oldRecords, this.batchSize);

      let totalInserted = 0;
      let totalSkipped = 0;
      let totalErrors = 0;

      logger.info(`📦 Số batches: ${batches.length}, mỗi batch ${this.batchSize} records`);

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        logger.info(`🔄 Batch ${i + 1}/${batches.length} (${batch.length} records)...`);

        for (const oldRecord of batch) {
          try {
            // 1. Kiểm tra Title
            if (!oldRecord.Title || oldRecord.Title.toString().trim() === '') {
              totalSkipped++;
              continue;
            }

            // 2. Kiểm tra đã migrate chưa
            const existing = await this.model.findByBackupId(oldRecord.ID);
            if (existing) {
              totalSkipped++;
              continue;
            }

            // 3. Map dữ liệu đơn giản
            const newRecord = {
              id: this.generateGuid(),
              name: oldRecord.Title.toString().trim(),
              description: oldRecord.Description || '',
              id_group_bk: oldRecord.ID,
              createdAt: oldRecord.Created || new Date(),
              updatedAt: oldRecord.Modified || new Date(),
              code: this.generateCode(oldRecord),
              type: this.getGroupType(oldRecord),
              status: 1,
              userId: null,  // OWNER = NULL
              roles: '[]',
              roles_dynamic: null,
              organizationUnits: null,
              permissionsId: null,
              roleType: null
            };

            // 4. Kiểm tra duplicate code
            const codeExists = await this.model.checkCodeExists(newRecord.code);
            if (codeExists) {
              newRecord.code = newRecord.code + '_' + oldRecord.ID.substring(0, 4);
            }

            // 5. Insert
            await this.model.insertToNewDb(newRecord);
            totalInserted++;

            // Log progress
            if (totalInserted % 50 === 0) {
              logger.info(`📈 Đã insert ${totalInserted} groups...`);
            }

          } catch (error) {
            totalErrors++;
            logger.error(`❌ Lỗi ${oldRecord?.ID || 'unknown'}: ${error.message}`);
          }
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      
      logger.info('✅ === HOÀN THÀNH MIGRATION GROUP ===');
      logger.info(`⏱️ Thời gian: ${duration}s`);
      logger.info(`✅ Inserted: ${totalInserted} | ⚠️ Skipped: ${totalSkipped} | ❌ Errors: ${totalErrors}`);

      return {
        success: totalErrors === 0,
        total: totalRecords,
        inserted: totalInserted,
        skipped: totalSkipped,
        errors: totalErrors,
        duration
      };

    } catch (error) {
      logger.error('❌ Lỗi trong quá trình migration Group:', error);
      throw error;
    }
  }

  // Helper methods
  generateCode(record) {
    try {
      if (record.Title) {
        // Tạo code từ Title: lấy các chữ cái đầu
        const title = record.Title.toString().trim();
        const words = title.split(' ');
        let code = '';
        
        for (const word of words) {
          if (word.length > 0 && /[a-zA-Z]/.test(word[0])) {
            code += word[0].toUpperCase();
          }
          if (code.length >= 4) break;
        }
        
        if (code.length > 0) {
          // Thêm số từ ID
          const idPart = record.ID ? record.ID.substring(0, 4).toUpperCase() : '0000';
          return code + '_' + idPart;
        }
      }
      
      // Fallback
      return 'GRP_' + (record.ID ? record.ID.substring(0, 8).toUpperCase() : Date.now().toString(36));
      
    } catch {
      return 'GRP_' + Date.now().toString(36);
    }
  }

  getGroupType(record) {
    try {
      if (record.SPGroupId) {
        const spId = parseInt(record.SPGroupId);
        if (spId === 1) return 'OWNER';
        if (spId === 2) return 'MEMBER';
        if (spId === 3) return 'VISITOR';
        if (spId === 20) return 'ALL';
        if (spId === 21) return 'ADMIN';
        if (spId === 22) return 'MANAGER';
        if (spId === 23) return 'EDITOR';
        if (spId === 24) return 'VIEWER';
      }
      return 'CUSTOM';
    } catch {
      return 'CUSTOM';
    }
  }

  async getStatistics() {
    try {
      const oldCount = await this.model.countOldDb();
      const newCount = await this.model.countNewDb();

      return {
        source: { 
          database: this.config.oldDatabase,
          schema: this.config.oldSchema, 
          table: this.config.oldTable, 
          count: oldCount 
        },
        destination: { 
          database: this.config.newDatabase,
          table: this.config.newTable, 
          count: newCount 
        },
        migrated: newCount,
        remaining: oldCount - newCount,
        percentage: ((newCount / oldCount) * 100).toFixed(1) + '%',
        status: oldCount === newCount ? 'Hoàn thành' : 'Đang thực hiện'
      };
    } catch (error) {
      logger.error('❌ Lỗi thống kê:', error);
      throw error;
    }
  }

  async close() {
    await this.model.close();
  }
}

module.exports = MigrationSharePointGroupService;
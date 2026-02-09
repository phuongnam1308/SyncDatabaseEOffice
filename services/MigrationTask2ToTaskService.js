// services/MigrationTask2ToTaskService.js
const Task2ToTaskModel = require('../models/Task2ToTaskModel');
const { tableMappings } = require('../config/tablesTask2ToTask');
const { mapFieldValues, chunkArray, formatNumber, calculatePercentage } = require('../utils/helpers');
const logger = require('../utils/logger');

class MigrationTask2ToTaskService {
  constructor() {
    this.model = new Task2ToTaskModel();
    this.batchSize = parseInt(process.env.BATCH_SIZE || '100');
  }

  async initialize() {
    await this.model.initialize();
    logger.info('MigrationTask2ToTaskService initialized');
  }

  async migrateTaskRecords() {
    const startTime = Date.now();
    logger.info('=== START MIGRATION TASK2 → TASK ===');

    const config = tableMappings.task2toTask;
    const totalRecords = await this.model.countSource();

    if (totalRecords === 0) {
      return { success: true, total: 0, inserted: 0, skipped: 0, errors: 0 };
    }

    const sourceRecords = await this.model.getAllSource();
    const batches = chunkArray(sourceRecords, this.batchSize);

    let inserted = 0;
    let skipped = 0;
    let errors = 0;

    for (let i = 0; i < batches.length; i++) {
      logger.info(`Processing batch ${i + 1}/${batches.length}`);
      for (const record of batches[i]) {
        try {
          const exists = await this.model.findByBackupId(record.id);
          if (exists) {
            skipped++;
            continue;
          }

          const newRecord = mapFieldValues(
            record,
            config.fieldMapping,
            config.defaultValues
          );

          await this.model.insertTarget(newRecord);
          inserted++;
        } catch (err) {
          errors++;
          logger.error(`Error migrate task2 ID ${record.id}: ${err.message}`);
        }
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    return {
      success: true,
      total: totalRecords,
      inserted,
      skipped,
      errors,
      duration
    };
  }

  async getStatistics() {
    const sourceCount = await this.model.countSource();
    const targetCount = await this.model.countTarget();

    return {
      source: { table: 'task2', count: sourceCount },
      destination: { table: 'task', count: targetCount },
      migrated: targetCount,
      remaining: sourceCount - targetCount,
      percentage: calculatePercentage(targetCount, sourceCount)
    };
  }

  async close() {
    await this.model.close();
  }
}

module.exports = MigrationTask2ToTaskService;

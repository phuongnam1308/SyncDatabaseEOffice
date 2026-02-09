const TaskAuditTestModel = require('../models/TaskAuditTestModel');
const logger = require('../utils/logger');

class TaskAuditTestService {
  constructor() {
    this.model = new TaskAuditTestModel();
  }

  async initialize() {
    await this.model.initialize();
  }

  async createAudit(dto) {
    logger.info('START create audit from task');

    const tasks = await this.model.getTaskIds();
    logger.info(`Total task found: ${tasks.length}`);

    let inserted = 0;
    let skipped = 0;
    let errors = 0;

    for (const t of tasks) {
      try {
        const exists = await this.model.existsAudit(t.id);
        if (exists) {
          skipped++;
          logger.warn(`Skip audit | taskId=${t.id} | reason=exists`);
          continue;
        }

        await this.model.insertAudit({
          document_id: t.id,
          origin_id: t.id,
          ...dto
        });

        inserted++;
        logger.info(`Insert audit success | taskId=${t.id}`);
      } catch (err) {
        errors++;
        logger.error(
          `Insert audit failed | taskId=${t.id} | error=${err.message}`
        );
      }
    }

    logger.info(
      `DONE create audit | inserted=${inserted} | skipped=${skipped} | errors=${errors}`
    );

    return {
      total: tasks.length,
      inserted,
      skipped,
      errors
    };
  }
}

module.exports = TaskAuditTestService;

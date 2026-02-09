const BaseModel = require('./BaseModel');
const logger = require('../utils/logger');

class OutgoingDocumentSyncModel extends BaseModel {
  constructor() {
    super();
    this.schema = 'dbo';
    this.table = 'outgoing_documents';
  }

  async countNeedSync() {
    try {
      const query = `
        SELECT COUNT(*) AS total
        FROM ${this.schema}.${this.table}
        WHERE table_backup = 'outgoing_documents2'
          AND (bpmn_version IS NULL OR bpmn_version <> 'VAN_BAN_DI')
      `;
      const result = await this.queryNewDb(query);
      return result[0]?.total || 0;
    } catch (error) {
      logger.error('countNeedSync error:', error);
      throw error;
    }
  }

  async syncBpmnVersion(limit) {
    try {
      const query = `
        UPDATE TOP (${limit}) ${this.schema}.${this.table}
        SET bpmn_version = 'VAN_BAN_DI'
        WHERE table_backup = 'outgoing_documents2'
          AND (bpmn_version IS NULL OR bpmn_version <> 'VAN_BAN_DI');

        SELECT @@ROWCOUNT AS affected;
      `;
      const result = await this.queryNewDb(query);
      return result[0]?.affected || 0;
    } catch (error) {
      logger.error('syncBpmnVersion error:', error);
      throw error;
    }
  }
}

module.exports = OutgoingDocumentSyncModel;

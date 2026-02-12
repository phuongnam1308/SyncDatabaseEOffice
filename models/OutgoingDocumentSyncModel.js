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

  // ========== FULL MAPPING METHODS (STEP 7) ==========

  /**
   * Đếm số records cần mapping đầy đủ
   */
  async countRecordsNeedFullMapping() {
    try {
      const query = `
        SELECT COUNT(*) AS total
        FROM ${this.schema}.${this.table}
        WHERE table_backup = 'outgoing_documents2'
      `;
      const result = await this.queryNewDb(query);
      return result[0]?.total || 0;
    } catch (error) {
      logger.error('countRecordsNeedFullMapping error:', error);
      throw error;
    }
  }

  /**
   * Lấy batch records cần mapping
   */
  async getRecordsForFullMappingBatch(limit) {
    try {
      const query = `
        SELECT TOP ${limit} 
          id, 
          document_type,
          urgency_level, 
          private_level,
          sender_unit,
          bpmn_version
        FROM ${this.schema}.${this.table}
        WHERE table_backup = 'outgoing_documents2'
        ORDER BY id
      `;
      return await this.queryNewDb(query);
    } catch (error) {
      logger.error('getRecordsForFullMappingBatch error:', error);
      throw error;
    }
  }

  /**
   * Update toàn bộ mapping cho một record
   */
  async updateFullMapping(id, data) {
    try {
      const updates = [];
      const params = { id };

      if (data.document_type !== undefined) {
        updates.push('document_type = @document_type');
        params.document_type = data.document_type;
      }

      if (data.urgency_level !== undefined) {
        updates.push('urgency_level = @urgency_level');
        params.urgency_level = data.urgency_level;
      }

      if (data.private_level !== undefined) {
        updates.push('private_level = @private_level');
        params.private_level = data.private_level;
      }

      if (data.sender_unit !== undefined) {
        updates.push('sender_unit = @sender_unit');
        params.sender_unit = data.sender_unit;
      }

      if (data.bpmn_version !== undefined) {
        updates.push('bpmn_version = @bpmn_version');
        params.bpmn_version = data.bpmn_version;
      }

      if (updates.length === 0) {
        return 0;
      }

      const query = `
        UPDATE ${this.schema}.${this.table}
        SET ${updates.join(', ')}
        WHERE id = @id;

        SELECT @@ROWCOUNT AS affected;
      `;

      const result = await this.queryNewDb(query, params);
      return result[0]?.affected || 0;
    } catch (error) {
      logger.error('updateFullMapping error:', error);
      throw error;
    }
  }
}

module.exports = OutgoingDocumentSyncModel;
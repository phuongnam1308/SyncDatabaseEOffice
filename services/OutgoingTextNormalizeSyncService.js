const OutgoingDocumentSyncModel = require('../models/OutgoingDocumentSyncModel');
const OutgoingDocumentMappingService = require('../services/OutgoingDocumentMappingService');
const logger = require('../utils/logger');

class OutgoingTextNormalizeSyncService {
  constructor() {
    this.model = new OutgoingDocumentSyncModel();
    this.mappingService = new OutgoingDocumentMappingService();
    this.batchSize = parseInt(process.env.BATCH_SIZE || '500');
  }

  async initialize() {
    await this.model.initialize();
    await this.mappingService.initialize();
  }

  /**
   * Thực hiện full mapping cho tất cả records
   * Bao gồm:
   * 1. Mapping document_type với S19 (crm_source_data)
   * 2. Mapping urgency_level với S20 (crm_source_data)
   * 3. Mapping private_level với S21 (crm_source_data)
   * 4. Chuẩn hóa sender_unit từ array thành string
   * 5. Set bpmn_version = 'VAN_BAN_DI' nếu null
   */
  async sync() {
    const startTime = Date.now();
    logger.info('=== START FULL MAPPING FOR OUTGOING_DOCUMENTS (STEP 7) ===');

    try {
      const total = await this.model.countRecordsNeedFullMapping();
      let processed = 0;
      let updated = 0;
      let skipped = 0;
      let errors = 0;

      logger.info(`Total records to process: ${total}`);

      // Process theo batch
      while (true) {
        const records = await this.model.getRecordsForFullMappingBatch(this.batchSize);
        if (records.length === 0) break;

        for (const record of records) {
          try {
            // Process record qua mapping service
            const updates = await this.mappingService.processRecord(record);

            // Nếu có updates thì update DB
            if (Object.keys(updates).length > 0) {
              const affected = await this.model.updateFullMapping(record.id, updates);
              if (affected > 0) {
                updated++;
                logger.debug(`✓ Updated record ID: ${record.id}`, updates);
              } else {
                skipped++;
              }
            } else {
              skipped++;
              logger.debug(`○ Skipped record ID: ${record.id} (no changes)`);
            }

            processed++;
          } catch (error) {
            errors++;
            logger.error(`✗ Error processing record ID: ${record.id}`, error);
          }
        }

        logger.info(`Processed batch: ${records.length} records | Total processed: ${processed}/${total} | Updated: ${updated} | Skipped: ${skipped} | Errors: ${errors}`);
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.info('=== END FULL MAPPING FOR OUTGOING_DOCUMENTS ===');

      const result = {
        success: true,
        total,
        processed,
        updated,
        skipped,
        errors,
        duration: `${duration}s`
      };

      logger.info('Full Mapping Summary:', result);
      return result;
    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.error('Error in full mapping sync:', error);
      
      return {
        success: false,
        error: error.message,
        duration: `${duration}s`
      };
    }
  }
}

module.exports = OutgoingTextNormalizeSyncService;
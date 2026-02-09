// services/SenderUnitUpdaterService.js
const { mapDonViToGuidArray } = require('../config/mappingOU');
const logger = require('../utils/logger');

class SenderUnitUpdaterService {
  constructor(model) {
    this.model = model;
  }

  async getStatistics() {
    try {
      const query = `
        SELECT 
          COUNT(*) AS total_records,
          SUM(CASE WHEN sender_unit IS NULL THEN 1 ELSE 0 END) AS missing_sender_unit,
          SUM(CASE WHEN DonVi IS NOT NULL AND DonVi LIKE '%#%' AND sender_unit IS NULL THEN 1 ELSE 0 END) AS ready_to_map
        FROM dbo.outgoing_documents2
      `;

      const result = await this.model.queryNewDb(query);
      let stats = { total_records: 0, missing_sender_unit: 0, ready_to_map: 0 };

      if (result?.recordset?.length > 0) {
        stats = result.recordset[0];
      } else if (result?.recordset) {
        stats = result.recordset;
      }

      const percentage = stats.total_records > 0 
        ? ((stats.total_records - stats.missing_sender_unit) / stats.total_records * 100).toFixed(2) 
        : '0.00';

      return {
        total: Number(stats.total_records || 0),
        missing: Number(stats.missing_sender_unit || 0),
        can_map: Number(stats.ready_to_map || 0),
        percentage_complete: `${percentage}%`
      };
    } catch (err) {
      logger.error('[SenderUnitUpdaterService] Lỗi thống kê sender_unit', err);
      return { total: 0, missing: 0, can_map: 0, percentage_complete: '0.00%', error: err.message };
    }
  }

  async updateAllMissing() {
    return this._updateBatch(Infinity);
  }

  async updateBatch(limit = 500) {
    return this._updateBatch(limit);
  }

  async _updateBatch(maxLimit) {
    const start = Date.now();
    let updated = 0;
    let errors = 0;

    try {
      let records = [];

      if (maxLimit === Infinity || maxLimit <= 0) {
        // Lấy toàn bộ record không giới hạn TOP
        const query = `
          SELECT id, DonVi
          FROM ${this.model.newSchema}.${this.model.newTable}
          WHERE sender_unit IS NULL 
            AND DonVi IS NOT NULL 
            AND DonVi LIKE '%#%'
          ORDER BY id ASC
        `;
        const result = await this.model.queryNewDb(query);
        records = result?.recordset || [];
      } else {
        // Lấy có giới hạn TOP
        const query = `
          SELECT TOP ${maxLimit} id, DonVi
          FROM ${this.model.newSchema}.${this.model.newTable}
          WHERE sender_unit IS NULL 
            AND DonVi IS NOT NULL 
            AND DonVi LIKE '%#%'
          ORDER BY id ASC
        `;
        const result = await this.model.queryNewDb(query);
        records = result?.recordset || [];
      }

      logger.info(`[SenderUnitUpdater] Bắt đầu update ${records.length} record`);

      for (const row of records) {
        try {
          const mapped = await mapDonViToGuidArray(row.DonVi, this.model.newPool, logger);
          if (mapped) {
            await this.model.updateSenderUnit(row.id, mapped);
            updated++;
            logger.info(`Updated id=${row.id} → ${mapped}`);
          }
        } catch (err) {
          errors++;
          logger.error(`Lỗi update id=${row.id}`, err);
        }
      }

      const duration = ((Date.now() - start) / 1000).toFixed(2);

      return {
        success: true,
        updated,
        errors,
        total_processed: records.length,
        duration: `${duration}s`
      };
    } catch (err) {
      logger.error('[SenderUnitUpdaterService] Lỗi batch update', err);
      throw err;
    }
  }

  async updateById(id) {
    try {
      const record = await this.model.findRecordById(id);
      if (!record) return { updated: false, reason: 'Không tìm thấy record' };
      if (record.sender_unit) return { updated: false, reason: 'Đã có sender_unit' };

      const mapped = await mapDonViToGuidArray(record.DonVi, this.model.newPool, logger);
      if (!mapped) return { updated: false, reason: 'Không map được DonVi' };

      await this.model.updateSenderUnit(id, mapped);
      return { updated: true, sender_unit: mapped };
    } catch (err) {
      logger.error(`Lỗi updateById id=${id}`, err);
      throw err;
    }
  }

  async testMapping(donVi) {
    try {
      const result = await mapDonViToGuidArray(donVi, this.model.newPool, logger);
      return {
        donVi,
        sender_unit: result || null,
        success: !!result
      };
    } catch (err) {
      logger.error('[SenderUnitUpdaterService] Lỗi test mapping', err);
      return { donVi, error: err.message, success: false };
    }
  }
}

module.exports = SenderUnitUpdaterService;
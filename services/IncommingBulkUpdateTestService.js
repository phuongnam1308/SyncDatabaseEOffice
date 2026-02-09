const IncommingBulkUpdateTestModel =
  require('../models/IncommingBulkUpdateTestModel');
const logger = require('../utils/logger');

class IncommingBulkUpdateTestService {
  constructor() {
    this.model = new IncommingBulkUpdateTestModel();
  }

  async initialize() {
    await this.model.initialize();
  }

  async update(payload) {
    const {
      status_code,
      sender_unit,
      receiver_unit
    } = payload;

    const fields = {};

    if (status_code !== undefined) {
      if (isNaN(Number(status_code))) {
        throw new Error('status_code phải là số');
      }
      fields.status_code = Number(status_code);
    }

    if (sender_unit !== undefined) {
      fields.sender_unit = sender_unit;
    }

    if (receiver_unit !== undefined) {
      fields.receiver_unit = receiver_unit;
    }

    logger.info(
      `Bulk update incomming_documents2 | fields=${JSON.stringify(fields)}`
    );

    const total = await this.model.countData();
    const updated = await this.model.bulkUpdate(fields);

    return {
      success: true,
      total,
      updated,
      applied: fields
    };
  }
}

module.exports = IncommingBulkUpdateTestService;

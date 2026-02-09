const IncomingStatusCodeUpdateModel = require(
  '../../models/IncomingStatusCodeUpdateModel'
);
const logger = require('../../utils/logger');

class UpdateIncomingStatusCodeService {
  constructor() {
    this.model = new IncomingStatusCodeUpdateModel();
  }

  async initialize() {
    await this.model.initialize();
  }

  async update() {
    logger.info('[UpdateIncomingStatusCode] START');

    const updatedRows =
      await this.model.updateStatusCodeByTrangThai();

    const statistic =
      await this.model.statisticStatusCode();

    logger.info(
      `[UpdateIncomingStatusCode] UPDATED: ${updatedRows}`
    );

    return {
      updatedRows,
      statistic
    };
  }
}

module.exports = UpdateIncomingStatusCodeService;

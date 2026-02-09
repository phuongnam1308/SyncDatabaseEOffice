const IncomingSenderUnitUpdateModel =
  require('../models/IncomingSenderUnitUpdateModel');
const logger = require('../utils/logger');

class UpdateIncomingSenderUnitService {
  constructor() {
    this.model = new IncomingSenderUnitUpdateModel();
  }

  async initialize() {
    await this.model.initialize();
  }

  async update() {
    logger.info('[UpdateIncomingSenderUnit] START');

    const updatedRows = await this.model.updateSenderUnit();
    const statistic = await this.model.statistic();

    logger.info(
      `[UpdateIncomingSenderUnit] UPDATED ROWS: ${updatedRows}`
    );

    return {
      updatedRows,
      statistic
    };
  }
}

module.exports = UpdateIncomingSenderUnitService;

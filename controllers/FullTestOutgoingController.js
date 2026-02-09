const BaseController = require('./BaseController');
const FullTestOutgoingService = require('../services/FullTestOutgoingService');
const logger = require('../utils/logger');

class FullTestOutgoingController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new FullTestOutgoingService();
      await this.service.initialize();
    }
  }

  runTest = this.asyncHandler(async (req, res) => {
    await this.initService();
    logger.info('API /test/full-test-outgoing called');
    const result = await this.service.run();
    return this.success(res, result, 'Full test outgoing process completed');
  });
}

module.exports = new FullTestOutgoingController();
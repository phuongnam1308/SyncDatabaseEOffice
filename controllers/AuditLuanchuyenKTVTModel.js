const BaseController = require('./BaseController');
const MigrationMessageNghiPhepCBQLService = require('../services/MigrationMessageNghiPhepCBQLService');

class MigrationMessageNghiPhepCBQLController extends BaseController {
  constructor() {
    super();
    this.service = new MigrationMessageNghiPhepCBQLService();
  }

  migrate = this.asyncHandler(async (req, res) => {
    await this.service.initialize();
    const rs = await this.service.migrate();
    return this.success(res, rs, 'Insert audit_message_nghiphep_cbql từ MessageNghiPhep_CBQL thành công');
  });
}

module.exports = new MigrationMessageNghiPhepCBQLController();
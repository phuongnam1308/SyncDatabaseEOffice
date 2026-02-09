const BaseController = require('./BaseController');
const FileRelationsMappingService = require('../services/FileRelationsMappingService');
const logger = require('../utils/logger');

/**
 * @swagger
 * tags:
 *   name: File Relations Mapping
 *   description: Mapping type_doc -> object_type
 */
class FileRelationsMappingController extends BaseController {
  constructor() {
    super();
    this.service = null;
  }

  async initService() {
    if (!this.service) {
      this.service = new FileRelationsMappingService();
      await this.service.initialize();
    }
  }

  /**
   * @swagger
   * /migrate/file-relations/object-type:
   *   post:
   *     summary: Mapping type_doc sang object_type
   *     tags: [File Relations Mapping]
   */
  mappingObjectType = this.asyncHandler(async (req, res) => {
    try {
      await this.initService();
      logger.info('[API] Mapping object_type');

      const result = await this.service.mappingObjectType();

      return this.success(
        res,
        result,
        'Mapping type_doc sang object_type thành công',
        result.total
      );
    } catch (error) {
      logger.error(error);
      return this.error(
        res,
        'Lỗi mapping type_doc sang object_type',
        500,
        error
      );
    }
  });
}

module.exports = new FileRelationsMappingController();

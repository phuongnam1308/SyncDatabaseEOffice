const FileRelations2ToMainService =
  require('../services/FileRelations2ToMainService');

class FileRelations2ToMainController {
  async migrate(req, res) {
    try {
      const service = new FileRelations2ToMainService();
      const count = await service.migrate();

      return res.json({
        status: 1,
        message: 'Migration file_relations2 → file_relations thành công',
        count,
        data: {}
      });
    } catch (e) {
      return res.status(500).json({
        status: 0,
        message: 'Migration file_relations2 → file_relations thất bại',
        error: e.message,
        data: {}
      });
    }
  }

  async statistics(req, res) {
    const service = new FileRelations2ToMainService();
    const data = await service.statistics();

    return res.json({
      status: 1,
      data
    });
  }
}

module.exports = new FileRelations2ToMainController();

const SyncAuditIncomingService = require('../services/SyncAuditIncomingService');

exports.sync = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '200', 10);
    const result = await SyncAuditIncomingService.sync(limit);

    res.json({
      success: true,
      message: 'Sync audit incoming success',
      data: result
    });
  } catch (err) {
    console.error('Sync audit incoming error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

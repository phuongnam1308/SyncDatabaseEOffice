const logger = require('../utils/logger');

class BaseController {
  // Response thành công
  success(res, data, message = 'Success', statusCode = 200) {
    return res.status(statusCode).json({
      success: true,
      message,
      data
    });
  }

  // Response lỗi
  error(res, message = 'Error', statusCode = 500, error = null) {
    logger.error(`${message}: ${error ? error.message : ''}`);
    
    return res.status(statusCode).json({
      success: false,
      message,
      error: error ? error.message : null
    });
  }

  // Response không tìm thấy
  notFound(res, message = 'Not Found') {
    return res.status(404).json({
      success: false,
      message
    });
  }

  // Response bad request
  badRequest(res, message = 'Bad Request', errors = null) {
    return res.status(400).json({
      success: false,
      message,
      errors
    });
  }

  // Response unauthorized
  unauthorized(res, message = 'Unauthorized') {
    return res.status(401).json({
      success: false,
      message
    });
  }

  // Wrap async handler
  asyncHandler(fn) {
    return (req, res, next) => {
      Promise.resolve(fn(req, res, next)).catch(next);
    };
  }
}

module.exports = BaseController;
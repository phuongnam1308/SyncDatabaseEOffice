const swaggerJSDoc = require('swagger-jsdoc');

module.exports = swaggerJSDoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Migration API',
      version: '1.0.0',
      description: 'API phục vụ migrate dữ liệu'
    },
    servers: [
      {
        url: `http://localhost:${process.env.PORT || 3020}/api`,
        description: 'API Server'
      }
    ]
  },
   apis: [
    './controllers/**/*.js',
    './routes/**/*.js',
      './DonVi/*.js',
    './modules/**/**/*.controller.js', // 🔥 quan trọng
  ]
});

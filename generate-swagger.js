require('dotenv').config();
const fs = require('fs');
const swaggerJSDoc = require('swagger-jsdoc');

const swaggerSpec = swaggerJSDoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'SNP - ĐỒNG BỘ DỮ LIỆU',
      version: '1.0.0',
      description: 'Hệ thống đồng bộ dữ liệu EOffice &mdash; SNP'
    },
    servers: [
      { url: `http://localhost:${process.env.PORT || 3021}/api` },
      { url: `http://SNP-DongBoDuLieu:${process.env.PORT || 3021}/api` }
    ]
  },
  apis: [
    './controllers/**/*.js', 
    './routes/**/*.js',
    './src/**/*.js'
  ]
});

fs.writeFileSync('swagger.json', JSON.stringify(swaggerSpec, null, 2));
console.log('✅ swagger.json generated');

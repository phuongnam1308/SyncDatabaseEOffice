require('dotenv').config();
const fs = require('fs');
const swaggerJSDoc = require('swagger-jsdoc');

const swaggerSpec = swaggerJSDoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Migration API',
      version: '1.0.0'
    },
    servers: [
      { url: `http://localhost:${process.env.PORT || 3020}/api` }
    ]
  },
  apis: ['./controllers/**/*.js', './routes/**/*.js']
});

fs.writeFileSync('swagger.json', JSON.stringify(swaggerSpec, null, 2));
console.log('✅ swagger.json generated');

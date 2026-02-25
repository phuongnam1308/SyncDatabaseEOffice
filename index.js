// // // require('dotenv').config();

// // // const express = require('express');
// // // const cors = require('cors');
// // // const routes = require('./routes');
// // // const logger = require('./utils/logger');
// // // const MigrationService = require('./services/MigrationOrganizationUnitsService');

// // // const PORT = process.env.PORT || 3000;
// // // const isMigrationMode = process.argv.includes('--migrate');
// // // const swaggerUi = require('swagger-ui-express');
// // // const swaggerDocument = require('./swagger/swagger.json');

// // // /**
// // //  * =========================
// // //  * MIGRATION MODE
// // //  * =========================
// // //  */
// // // if (isMigrationMode) {
// // //   logger.info('🚀 Chạy ở chế độ MIGRATION');

// // //   (async () => {
// // //     const migrationService = new MigrationService();

// // //     try {
// // //       await migrationService.initialize();
// // //       logger.info('✅ Khởi tạo Migration Service');

// // //       await migrationService.migratePhongBan();

// // //       await migrationService.close();
// // //       logger.info('🎉 Migration hoàn thành');

// // //       process.exit(0);
// // //     } catch (error) {
// // //       logger.error('❌ Lỗi migration:', error);

// // //       try {
// // //         await migrationService.close();
// // //       } catch (_) {}

// // //       process.exit(1);
// // //     }
// // //   })();

// // //   return;
// // // }

// // // /**
// // //  * =========================
// // //  * API SERVER MODE
// // //  * =========================
// // //  */
// // // const app = express();

// // // // Middleware
// // // app.use(cors());
// // // app.use(express.json());
// // // app.use(express.urlencoded({ extended: true }));

// // // // Routes
// // // app.use('/api', routes);

// // // // Global error handler
// // // app.use((err, req, res, next) => {
// // //   logger.error(err);

// // //   res.status(500).json({
// // //     success: false,
// // //     message: 'Internal Server Error',
// // //     error: process.env.NODE_ENV === 'production' ? undefined : err.message
// // //   });
// // // });

// // // // Start server
// // // // app.listen(PORT, () => {
// // // //   logger.info(`🚀 Server running at http://localhost:${PORT}`);
// // // //   logger.info(`🌱 Environment: ${process.env.NODE_ENV || 'development'}`);
// // // // });


// // // // swagger ← SAU router
// // // app.use(
// // //   '/swagger',
// // //   swaggerUi.serve,
// // //   swaggerUi.setup(swaggerDocument, {
// // //     customCss: `
// // //       body {
// // //         background-color: #0f172a;
// // //       }
// // //       .swagger-ui {
// // //         filter: invert(1) hue-rotate(180deg);
// // //       }
// // //     `
// // //   })
// // // );

// // // // ===== Start server =====
// // // app.listen(PORT, () => {
// // //   console.log(`🚀 Server chạy: http://localhost:${PORT}`);
// // //   console.log(`📘 Swagger: http://localhost:${PORT}/swagger`);
// // // });

// // // // Graceful shutdown
// // // const shutdown = (signal) => {
// // //   logger.info(`${signal} received. Shutting down...`);
// // //   process.exit(0);
// // // };

// // // process.on('SIGTERM', shutdown);
// // // process.on('SIGINT', shutdown);


// // require('dotenv').config();

// // const express = require('express');
// // const cors = require('cors');
// // const swaggerUi = require('swagger-ui-express');

// // const routes = require('./routes');
// // const logger = require('./utils/logger');
// // const MigrationService = require('./services/MigrationOrganizationUnitsService');
// // const swaggerSpec = require('./swagger/swagger');

// // const PORT = process.env.PORT || 3020;
// // const isMigrationMode = process.argv.includes('--migrate');

// // /**
// //  * =========================
// //  * MIGRATION MODE
// //  * =========================
// //  */
// // if (isMigrationMode) {
// //   logger.info('🚀 Chạy ở chế độ MIGRATION');

// //   (async () => {
// //     const migrationService = new MigrationService();

// //     try {
// //       await migrationService.initialize();
// //       await migrationService.migratePhongBan();
// //       await migrationService.close();

// //       logger.info('🎉 Migration hoàn thành');
// //       process.exit(0);
// //     } catch (error) {
// //       logger.error('❌ Lỗi migration:', error);
// //       process.exit(1);
// //     }
// //   })();

// //   return;
// // }

// // /**
// //  * =========================
// //  * API SERVER MODE
// //  * =========================
// //  */
// // const app = express();

// // // Middleware
// // app.use(cors());
// // app.use(express.json());
// // app.use(express.urlencoded({ extended: true }));

// // /**
// //  * 🚀 API PREFIX
// //  */
// // app.use('/api', routes);

// // /**
// //  * 📘 Swagger (SAU router cũng được)
// //  */
// // app.use(
// //   '/swagger',
// //   swaggerUi.serve,
// //   swaggerUi.setup(swaggerSpec, {
// //     customCss: `
// //       body { background-color: #0f172a; }
// //       .swagger-ui { filter: invert(1) hue-rotate(180deg); }
// //     `
// //   })
// // );

// // /**
// //  * Health check
// //  */
// // app.get('/health', (req, res) => {
// //   res.json({ status: 'OK' });
// // });

// // /**
// //  * Error handler
// //  */
// // app.use((err, req, res, next) => {
// //   logger.error(err);
// //   res.status(500).json({
// //     success: false,
// //     message: 'Internal Server Error',
// //     error: process.env.NODE_ENV === 'production' ? undefined : err.message
// //   });
// // });

// // app.listen(PORT, () => {
// //   console.log(`🚀 Server: http://localhost:${PORT}`);
// //   console.log(`📘 Swagger: http://localhost:${PORT}/swagger`);
// // });


// require('dotenv').config();

// const express = require('express');
// const cors = require('cors');
// const swaggerUi = require('swagger-ui-express');

// const routes = require('./routes');
// const logger = require('./utils/logger');
// const MigrationService = require('./services/MigrationOrganizationUnitsService');

// const PORT = process.env.PORT || 3020;
// const isMigrationMode = process.argv.includes('--migrate');

// /**
//  * =========================
//  * Load Swagger Spec linh hoạt
//  * - Dev: generate dynamic từ swagger-jsdoc
//  * - Build/Production: load file swagger.json tĩnh (đã sinh trước bằng generate-swagger.js)
//  * =========================
//  */
// let swaggerSpec;
// try {
//   // Ưu tiên load file JSON tĩnh nếu tồn tại (sau build)
//   swaggerSpec = require('./swagger.json');
//   console.log('✅ Loaded static swagger.json (build / production mode)');
// } catch (err) {
//   // Fallback cho dev mode: generate dynamic
//   console.log('⚠️ swagger.json not found → using dynamic generation (dev mode)');
//   const swaggerJSDoc = require('swagger-jsdoc');
//   swaggerSpec = swaggerJSDoc({
//     definition: {
//       openapi: '3.0.0',
//       info: {
//         title: 'Migration API',
//         version: '1.0.0',
//         description: 'API phục vụ migrate dữ liệu từ DataEOfficeSNP sang DiOffice'
//       },
//       servers: [
//         {
//           url: `http://localhost:${PORT}/api`,
//           description: 'Local Development Server'
//         }
//       ]
//     },
//     apis: [
//       './controllers/**/*.js',
//       './routes/**/*.js'
//     ]
//   });
// }

// /**
//  * =========================
//  * MIGRATION MODE
//  * =========================
//  */
// if (isMigrationMode) {
//   logger.info('🚀 Chạy ở chế độ MIGRATION');

//   (async () => {
//     const migrationService = new MigrationService();

//     try {
//       await migrationService.initialize();
//       logger.info('✅ Khởi tạo Migration Service');

//       await migrationService.migratePhongBan();

//       await migrationService.close();
//       logger.info('🎉 Migration hoàn thành');

//       process.exit(0);
//     } catch (error) {
//       logger.error('❌ Lỗi migration:', error);

//       try {
//         await migrationService.close();
//       } catch (_) {}

//       process.exit(1);
//     }
//   })();

//   return;
// }

// /**
//  * =========================
//  * API SERVER MODE
//  * =========================
//  */
// const app = express();

// // Middleware
// app.use(cors());
// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));


// const path = require('path');

// app.get('/swagger.json', (req, res) => {
//   res.sendFile(path.join(__dirname, 'swagger.json'));
// });
// /**
//  * 📘 Swagger UI
//  */
// app.use(
//   '/swagger',
//   swaggerUi.serve,
//   swaggerUi.setup(swaggerSpec, {
//     customCss: `
//       body { background-color: #cecece; }
//       .swagger-ui { filter: invert(1) hue-rotate(180deg); }
//     `,
//     customSiteTitle: 'Migration API Docs'
//   })
// );

// /**
//  * 🚀 API PREFIX
//  */
// app.use('/api', routes);
// // app.use(
// //   '/swagger',
// //   swaggerUi.serve,
// //   swaggerUi.setup(swaggerDocument)
// // );
// /**
//  * Health check
//  */
// app.get('/health', (req, res) => {
//   res.json({ status: 'OK', uptime: process.uptime() });
// });

// /**
//  * Error handler
//  */
// app.use((err, req, res, next) => {
//   logger.error(err);
//   res.status(500).json({
//     success: false,
//     message: 'Internal Server Error',
//     error: process.env.NODE_ENV === 'production' ? undefined : err.message
//   });
// });

// app.listen(PORT, () => {
//   console.log(`🚀 Server running at: http://localhost:${PORT}`);
//   console.log(`📘 Swagger UI: http://localhost:${PORT}/swagger`);
//   console.log(`🔍 Health check: http://localhost:${PORT}/health`);
// });

// // Graceful shutdown (tùy chọn, giữ nguyên nếu bạn muốn)
// const shutdown = (signal) => {
//   console.log(`${signal} received. Shutting down gracefully...`);
//   process.exit(0);
// };

// process.on('SIGTERM', shutdown);
// process.on('SIGINT', shutdown);

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const routes = require('./routes');
const logger = require('./utils/logger');
const MigrationService = require('./services/MigrationOrganizationUnitsService');

const PORT = process.env.PORT || 3020;
const isMigrationMode = process.argv.includes('--migrate');

/**
 * =========================
 * MIGRATION MODE
 * =========================
 */
if (isMigrationMode) {
  logger.info('🚀 MIGRATION MODE');

  (async () => {
    const migrationService = new MigrationService();
    try {
      await migrationService.initialize();
      await migrationService.migratePhongBan();
      await migrationService.close();
      logger.info('🎉 Migration done');
      process.exit(0);
    } catch (err) {
      logger.error(err);
      process.exit(1);
    }
  })();

  return;
}

/**
 * =========================
 * API SERVER
 * =========================
 */
const app = express();
app.use(cors());
app.use(express.json());

/**
 * API
 */
app.use('/api', routes);

/**
 * Swagger JSON
 */
app.get('/swagger.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'swagger.json'));
});

/**
 * Swagger UI (HTML tĩnh)
 */
app.use(
  '/swagger',
  express.static(path.join(__dirname, 'swagger'))
);

/**
 * Health
 */
app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server: http://localhost:${PORT}`);
  console.log(`📘 Swagger: http://localhost:${PORT}/swagger`);
});

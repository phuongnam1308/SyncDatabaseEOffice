const path = require('path');
const net = require('net');
const { exec } = require('child_process');

// [DEBUG] Bay loi de giu Terminal khong bi dong khi crash
process.on('uncaughtException', (err) => {
  console.error('\n\n❌ [LOI ROI] CHU TRINH GAP SU CO NGHIEM TRONG:');
  console.error('======================================================');
  console.error(err.stack || err);
  console.error('======================================================');
  console.log('\nNhan Enter de thoat...');
  process.stdin.resume();
  process.stdin.on('data', () => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  console.error('\n\n⚠️ [CANH BAO] PROMISE BI TU CHOI:');
  console.error(reason.stack || reason);
  console.log('\nNhan Enter de thoat...');
  process.stdin.resume();
  process.stdin.on('data', () => process.exit(1));
});

/**
 * QUY TRINH KIEM TRA "CHAY DUY NHAT MOT BAN" (SINGLE INSTANCE)
 * Su dung cong canh gac 3020 de dam bao chi co 1 ban duoc chay.
 */
const LOCK_PORT = 3020; 
const lockServer = net.createServer();

lockServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // Da co ban chay roi, thoat ngay lap tuc
    process.exit(0);
  }
});

// Giu cong nay suot thoi gian ung dung song
lockServer.listen(LOCK_PORT, '127.0.0.1');

const exeDir = path.dirname(process.execPath);
require('dotenv').config({ path: path.join(exeDir, '.env') });
const express = require('express');
const cors = require('cors');

const routes = require('./routes');
const logger = require('./utils/logger');
const MigrationService = require('./services/MigrationOrganizationUnitsService');
const CronSyncScheduler = require('./src/sync-manager/CronSyncScheduler');
const loginFlow = require('./auth/login_playwright');

// Helper để xác định đường dẫn bên ngoài EXE (dùng cho config/logs/auth)
const isSea = process.execPath.toLowerCase().endsWith('.exe');
const isPkg = false; // Chung ta dung SEA nen Pkg la false
const externalDir = isSea ? path.dirname(process.execPath) : process.cwd();
const internalDir = __dirname;

/**
 * TU DONG TAO SHORTCUT RA DESKTOP KHI MO UNG DUNG
 */
const ensureDesktopShortcut = () => {
  if (!isSea) return;
  const shortcutName = 'SNP - DONG BO DU LIEU.lnk';
  const exePath = process.execPath;
  const iconPath = path.join(exeDir, 'icon.ico');
  
  // Script PowerShell de tao shortcut mot cach chinh xac
  const psCommand = `
    $desktop = [Environment]::GetFolderPath('Desktop');
    $path = Join-Path $desktop '${shortcutName}';
    if (-not (Test-Path $path)) {
      $ws = New-Object -ComObject WScript.Shell;
      $s = $ws.CreateShortcut($path);
      $s.TargetPath = '${exePath}';
      $s.WorkingDirectory = '${exeDir}';
      if (Test-Path '${iconPath}') { $s.IconLocation = '${iconPath}'; }
      $s.Save();
    }
  `.replace(/\n/g, ' ').trim();

  // Su dung duong dan tuyet doi de tranh loi Windows ko nhan ra lenh powershell
  const psPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  
  exec(`"${psPath}" -ExecutionPolicy Bypass -Command "${psCommand}"`, (err) => {
    if (err) console.error('⚠️ Khong the tao shortcut tu dung:', err.message);
    else console.log('🚀 Da tu dong kiem tra va tao shortcut ngoai Desktop.');
  });
};

// Chon hieu ung tu dong tao ngay khi chay
ensureDesktopShortcut();

// Ưu tiên PORT 3021 cho đúng yêu cầu của đồng chí
const PORT = process.env.PORT || 3021;
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
 * Swagger JSON API
 */
app.get('/swagger.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'swagger.json'));
});

/**
 * Swagger UI (Giao dien tai lieu API)
 */
app.use(
  '/swagger',
  express.static(path.join(__dirname, 'swagger'))
);

/**
 * Tai nguyen tinh (Bootstrap Icons, Font Inter, v.v.)
 */
app.use(
  '/assets/bootstrap-icons',
  express.static(path.join(__dirname, 'node_modules/bootstrap-icons'))
);
app.use(
  '/assets/inter',
  express.static(path.join(__dirname, 'node_modules/@fontsource/inter'))
);

/**
 * Health Check
 */
app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

/**
 * KHOI DONG SERVER
 */
app.listen(PORT, () => {
  const url = `http://localhost:${PORT}/api/sync-manager-src/dashboard`;
  
  logger.info('------------------------------------------------------');
  logger.info(`⚓ SNP SYNC SERVER IS RUNNING ON PORT ${PORT}`);
  logger.info(`🌐 Dashboard: ${url}`);
  logger.info('------------------------------------------------------');

  // Tu dong chay Login Flow (Playwright) neu la ban dong goi
  if (isSea || isPkg) {
    logger.info('🔑 Dang khoi dong quy trinh dang nhap tu dong...');
    loginFlow().catch((loginErr) => {
      logger.error('❌ Loi trong qua trinh dang nhap tu dong:', loginErr);
    });
  }

  // Tu dong mo Dashboard khi khởi chạy bản đóng gói (.exe)
  if (process.env.NODE_ENV === 'production' || isPkg || isSea) {
    logger.info(`✨ Dang tu dong mo Dashboard: ${url}`);
    exec(`start "" "${url}"`);
  }

  // Khoi dong Cron Sync
  CronSyncScheduler.start().catch((error) => {
    logger.error('[index] Cannot start CronSyncScheduler:', error);
  });
});

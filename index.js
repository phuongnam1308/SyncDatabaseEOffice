const path = require('path');
const net = require('net');
const { exec } = require('child_process');

// [DEBUG] Bẫy lỗi để giữ Terminal không bị đóng khi crash
process.on('uncaughtException', (err) => {
  console.error('\n\n❌ [LỖI HỆ THỐNG] CHƯƠNG TRÌNH GẶP SỰ CỐ NGHIÊM TRỌNG:');
  console.error('======================================================');
  console.error(err.stack || err);
  console.error('======================================================');
  console.log('\n[!] Hệ thống vẫn tiếp tục chạy để đồng chí kiểm tra lỗi.');
});

process.on('unhandledRejection', (reason) => {
  console.error('\n\n⚠️ [CẢNH BÁO] PHÁT SINH LỖI KHÔNG MONG MUỐN:');
  console.error(reason.stack || reason);
  console.log('\n[!] Hệ thống vẫn tiếp tục chạy để đồng chí kiểm tra lỗi.');
});

/**
 * XÁC ĐỊNH MÔI TRƯỜNG CHẠY (Dev/CLI vs EXE/SEA)
 */
const isPkg = typeof process.pkg !== 'undefined';
// Nếu tên file không phải là node.exe thì mới coi là bản đóng gói SEA
const isSea = path.basename(process.execPath).toLowerCase() !== 'node.exe' && process.execPath.toLowerCase().endsWith('.exe');
const exeDir = isPkg || isSea ? path.dirname(process.execPath) : process.cwd();

require('dotenv').config({ path: path.join(exeDir, '.env') });
const express = require('express');
const cors = require('cors');

const routes = require('./routes');
const logger = require('./utils/logger');
const MigrationService = require('./services/MigrationOrganizationUnitsService');
const CronSyncScheduler = require('./src/sync-manager/CronSyncScheduler');
const loginFlow = require('./auth/login_playwright');
const { startSessionRefresher } = require('./auth/session-refresher');

const isProduction = process.env.NODE_ENV === 'production' || isPkg || isSea;
const externalDir = exeDir;
const internalDir = __dirname;

/**
 * TỰ ĐỘNG TẠO SHORTCUT RA DESKTOP KHI MỞ ỨNG DỤNG
 */
const ensureDesktopShortcut = () => {
  if (!isSea) return;
  const shortcutName = 'SNP - ĐỒNG BỘ DỮ LIỆU.lnk';
  const exePath = process.execPath;
  const iconPath = path.join(exeDir, 'icon.ico');

  // Sử dụng file PS1 tạm thời để xử lý triệt để Tiếng Việt
  const tempPs = path.join(require('os').tmpdir(), `create_shortcut_${Date.now()}.ps1`);
  const safeExePath = exePath.replace(/\\/g, '\\\\');
  const safeExeDir = exeDir.replace(/\\/g, '\\\\');
  const safeIconPath = iconPath.replace(/\\/g, '\\\\');

  const psScriptContent = `
    $desktop = [Environment]::GetFolderPath('Desktop');
    $path = Join-Path $desktop '${shortcutName}';
    if (Test-Path $path) { Remove-Item $path -Force }
    $ws = New-Object -ComObject WScript.Shell;
    $s = $ws.CreateShortcut($path);
    $s.TargetPath = '${safeExePath}';
    $s.WorkingDirectory = '${safeExeDir}';
    if (Test-Path '${safeIconPath}') { $s.IconLocation = '${safeIconPath},0'; }
    $s.Save();
  `.replace(/\n/g, '\r\n').trim();

  try {
    require('fs').writeFileSync(tempPs, '\ufeff' + psScriptContent, { encoding: 'utf8' });
    const psPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    exec(`"${psPath}" -ExecutionPolicy Bypass -File "${tempPs}"`, (err) => {
      try { if (require('fs').existsSync(tempPs)) require('fs').unlinkSync(tempPs); } catch (e) { }
      if (err) console.error('⚠️ Không thể tạo shortcut tự động:', err.message);
      else console.log('🚀 Đã tự động kiểm tra và tạo shortcut ngoài Desktop.');
    });
  } catch (err) {
    console.error('⚠️ Lỗi khi chuẩn bị file shortcut ps1:', err.message);
  }
};

// Chạy hiệu ứng tự động tạo ngay khi khởi động
ensureDesktopShortcut();

// Ưu tiên PORT 3025 cho đúng yêu cầu của đồng chí
const PORT = process.env.PORT || 3025;

/**
 * [MULTI-INSTANCE SAFE]
 * Kiểm tra cổng PORT. Nếu bị chiếm bởi cùng PID khác → chỉ cảnh báo, KHÔNG kill.
 * Cho phép mở nhiều cổng khác nhau (PORT=3021, PORT=3022, ...) song song.
 * Các job đang chạy ở instance khác được bảo vệ nhờ Graceful Shutdown phía dưới.
 */
if (process.platform === 'win32') {
  try {
    const { execSync } = require('child_process');
    const netstat = execSync(`netstat -ano | findstr :${PORT}`).toString();
    const lines = netstat.split('\n').filter(line => line.includes('LISTENING'));
    if (lines.length > 0) {
      const parts = lines[0].trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && pid !== '0' && pid !== process.pid.toString()) {
        console.warn(`⚠️  [MULTI-INSTANCE] Cổng ${PORT} đã có tiến trình PID=${pid} đang dùng.`);
        console.warn(`   → Để tránh conflict, hãy đổi PORT trong .env (vd: PORT=3022).`);
        // KHÔNG kill, KHÔNG exit — để người dùng tự quyết định
      }
    }
  } catch (e) {
    // Bình thường — không có tiến trình nào chiếm cổng
  }
}


const isMigrationMode = process.argv.includes('--migrate');

/**
 * =========================
 * CHẾ ĐỘ DI CƯ DỮ LIỆU (MIGRATION)
 * =========================
 */
if (isMigrationMode) {
  logger.info('🚀 ĐANG TRONG CHẾ ĐỘ DI CƯ DỮ LIỆU');

  (async () => {
    const migrationService = new MigrationService();
    try {
      await migrationService.initialize();
      await migrationService.migratePhongBan();
      await migrationService.close();
      logger.info('🎉 Hoàn tất di cư dữ liệu');
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
 * API Swagger JSON
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
  logger.info(`⚓ MÁY CHỦ ĐỒNG BỘ SNP ĐANG CHẠY TẠI CỔNG ${PORT}`);
  logger.info(`🌐 Bảng điều khiển: ${url}`);
  logger.info('------------------------------------------------------');

  // Tự động chạy Login Flow (Playwright) nếu là bản đóng gói
  if (isSea || isPkg) {
    logger.info('🔑 Đang khởi động quy trình đăng nhập tự động...');
    loginFlow().catch((loginErr) => {
      logger.error('❌ Lỗi trong quá trình đăng nhập tự động:', loginErr);
    });
  }

  // Tự động mở Dashboard khi khởi chạy bản đóng gói (.exe) - Ưu tiên Chrome
  if (process.env.NODE_ENV === 'production' || isPkg || isSea) {
    logger.info(`✨ Đang tự động mở Bảng điều khiển: ${url}`);

    // Thử kiểm tra Chrome ở các đường dẫn phổ biến
    const chromePaths = [
      process.env.CHROME_PATH,
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
    ].filter(Boolean);

    let chromeExec = null;
    const fs = require('fs');
    for (const p of chromePaths) {
      if (fs.existsSync(p.replace(/"/g, ''))) {
        chromeExec = p;
        break;
      }
    }

    if (chromeExec) {
      logger.info('🎯 Đã tìm thấy Google Chrome! Đang mở Bảng điều khiển...');
      // Sử dụng Playwright để quản lý cửa sổ app
      (async () => {
        try {
          let playwright;
          try {
            // Ưu tiên require thông thường (cho môi trường dev/node)
            playwright = require('playwright');
          } catch (e) {
            // Nếu fail, thử dùng createRequire (cho môi trường EXE/SEA)
            const { createRequire } = require('module');
            const myRequire = createRequire(path.join(exeDir, 'index.js'));
            playwright = myRequire('playwright');
          }

          const browser = await playwright.chromium.launch({
            headless: false,
            executablePath: chromeExec.replace(/"/g, ''),
            args: [`--app=${url}`, '--window-size=1280,800']
          });

          // LƯU TOÀN CỤC ĐỂ ĐIỀU KHIỂN TỪ SHUTDOWN API
          global.appBrowser = browser;

          const pages = await browser.pages();
          if (pages.length > 0) {
            pages[0].on('close', () => {
              logger.info('👋 Bảng điều khiển đã bị đóng. Đang tắt toàn bộ hệ thống...');
              process.exit(0);
            });
          }

          browser.on('disconnected', () => {
            logger.info('👋 Trình duyệt đã ngắt kết nối. Đang tắt hệ thống...');
            process.exit(0);
          });

          // Bẫy tín hiệu để đóng browser khi Terminal bị tắt
          process.on('SIGINT', async () => {
            await browser.close().catch(() => { });
            process.exit(0);
          });

        } catch (pwErr) {
          logger.warn('⚠️ Playwright gặp sự cố khi mở cửa sổ App: ' + pwErr.message);
          exec(`start "" "${chromeExec}" "${url}"`);
        }
      })();
    } else {
      logger.warn('⚠️ Không tìm thấy Google Chrome. Đang sử dụng trình duyệt mặc định...');
      exec(`start chrome "${url}"`, (err) => {
        if (err) exec(`start "" "${url}"`);
      });
    }
  }

  // Khởi động Lịch Đồng Bộ (Cron)
  CronSyncScheduler.start().catch((error) => {
    logger.error('[index] Không thể khởi động Lịch Đồng Bộ:', error);
  });

  // Khởi động trình làm mới Session (mỗi 10 phút kiểm tra token SharePoint)
  startSessionRefresher();
});

/**
 * [GLOBAL ERROR HANDLER]
 */
app.use((err, req, res, next) => {
  logger.error(`[GlobalError] \${err.message}`);
  if (err.stack) logger.debug(err.stack);
  
  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error',
    error: err.message
  });
});

/**
 * [GRACEFUL SHUTDOWN]
 * Khi tắt chương trình (Ctrl+C, nodemon restart, kill process),
 * tự động chuyển tất cả job RUNNING → PAUSED trong DB.
 * Timeout 3s đảm bảo DB write kịp flush trước khi process.exit.
 * Mục đích: khi khởi động lại, các job Resume được thay vì bị stuck ở RUNNING.
 */
let _shuttingDown = false;
async function gracefulShutdown(signal) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  logger.info(`\n🛑 [GracefulShutdown] Nhận tín hiệu ${signal}. Đang tạm dừng các job đang chạy...`);

  const doShutdown = async () => {
    try {
      const SyncManagerService = require('./src/sync-manager/SyncManagerService');
      const svc = SyncManagerService.getInstance ? SyncManagerService.getInstance() : SyncManagerService;
      if (svc && typeof svc.pauseAllRunningJobs === 'function') {
        await svc.pauseAllRunningJobs();
        logger.info('✅ [GracefulShutdown] Đã tạm dừng tất cả job. Hệ thống tắt an toàn.');
      }
    } catch (err) {
      logger.error(`[GracefulShutdown] Lỗi khi tạm dừng job: ${err.message}`);
    }
  };

  // Race giữa shutdown logic và timeout 3s
  // → nếu DB write quá chậm, vẫn thoát sau 3s thay vì treo mãi
  await Promise.race([
    doShutdown(),
    new Promise(resolve => setTimeout(resolve, 3000))
  ]);

  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

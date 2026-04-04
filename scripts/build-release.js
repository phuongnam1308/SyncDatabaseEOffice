const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const archiver = require('archiver');

/**
 * SCRIPT BUILD-RELEASE: "MUOT" VA ON DINH
 * Thuc hien moi thu tu SEA, Copy deps den Zip Release
 */

function copyRecursiveSync(src, dest) {
    const exists = fs.existsSync(src);
    const stats = exists && fs.statSync(src);
    const isDirectory = exists && stats.isDirectory();
    if (isDirectory) {
        if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
        fs.readdirSync(src).forEach(childItemName => {
            copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
        });
    } else {
        fs.copyFileSync(src, dest);
    }
}

async function buildRelease() {
    const rootDir = path.join(__dirname, '..');
    const distDir = path.join(rootDir, 'dist');
    const exeName = 'SNP - DONG BO DU LIEU.exe';
    const targetExe = path.join(distDir, exeName);
    const seaBlob = path.join(distDir, 'sea-prep.blob');
    const sentinel = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

    console.log('--- 🚀 BAT DAU QUY TRINH DONG GOI RELEASE (MUOT) ---');

    // 1. Copy Node.js executable
    console.log('1. Dang tao file thuc thi (.exe)...');
    fs.copyFileSync(process.execPath, targetExe);
    console.log('✅ Da tao file EXE.');

    // 2. Inject SEA Blob bang postject
    console.log('2. Dang nhung du lieu core (SEA Injection)...');
    try {
        const postjectCmd = `npx postject "${targetExe}" NODE_SEA_BLOB "${seaBlob}" --sentinel-fuse ${sentinel}`;
        execSync(postjectCmd, { stdio: 'inherit' });
        console.log('✅ Da nhung du lieu thanh cong.');
    } catch (err) {
        console.error('❌ Loi khi nhung SEA Blob:', err.message);
        process.exit(1);
    }

    // 3. Copy thu vien node_modules
    console.log('3. Dang chép thu vien node_modules (vui long doi)...');
    const srcModules = path.join(rootDir, 'node_modules');
    const distModules = path.join(distDir, 'node_modules');
    if (fs.existsSync(srcModules)) {
        copyRecursiveSync(srcModules, distModules);
        console.log('✅ Da chép xong node_modules.');
    } else {
        console.warn('⚠️ Khong tim thay node_modules goc!');
    }

    // 4. Copy cac tai nguyen phu (Icon, Zip du phong)
    console.log('4. Dang chép cac tai nguyen bo sung...');
    const assets = ['icon.png', 'icon.ico', 'node_modules.zip'];
    assets.forEach(file => {
        const src = path.join(rootDir, file);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(distDir, file));
            console.log(`   - Da chép: ${file}`);
        }
    });

    // 5. Nen thanh ban Release (build_version)
    console.log('5. Dang nen ban Release vao build_version...');
    const buildVersionDir = path.join(rootDir, 'build_version');
    if (!fs.existsSync(buildVersionDir)) fs.mkdirSync(buildVersionDir, { recursive: true });

    const now = new Date();
    const timestamp = now.getFullYear().toString() +
        (now.getMonth() + 1).toString().padStart(2, '0') +
        now.getDate().toString().padStart(2, '0') + '_' +
        now.getHours().toString().padStart(2, '0') +
        now.getMinutes().toString().padStart(2, '0') +
        now.getSeconds().toString().padStart(2, '0');

    const zipFileName = `snp_sync_${timestamp}.zip`;
    const zipPath = path.join(buildVersionDir, zipFileName);

    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    return new Promise((resolve, reject) => {
        output.on('close', () => {
            console.log(`✅ HOAN TAT!`);
            console.log(`📍 File Release: ${zipPath}`);
            console.log(`📦 Dung luong: ${(archive.pointer() / 1024 / 1024).toFixed(2)} MB`);
            resolve();
        });
        archive.on('error', err => reject(err));
        archive.pipe(output);
        archive.directory(distDir, 'snp_sync');
        archive.finalize();
    });
}

buildRelease().catch(err => {
    console.error('❌ QUY TRINH THAT BAI:', err.message);
    process.exit(1);
});

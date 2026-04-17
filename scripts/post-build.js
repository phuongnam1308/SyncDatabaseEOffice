const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const archiver = require('archiver');

/**
 * QUY TRINH HAU KY (POST-BUILD) - GIA CO VA MINH BACH
 * Thuc hien moi thu tu: Copy EXE -> SEA Inject -> Copy Deps -> Fix Icon -> Zip Release
 */

async function postBuild() {
    const rootDir = path.join(__dirname, '..');
    const distDir = path.join(rootDir, 'dist');
    const exeName = 'SNP - DONG BO DU LIEU.exe';
    const targetExe = path.join(distDir, exeName);
    const seaBlob = path.join(distDir, 'sea-prep.blob');
    const sentinel = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

    console.log('\n--- 🚀 BAT DAU QUY TRINH DONG GOI VA LUU TRU PHIEN BAN ---');

    // 1. Tao file thuc thi (.exe)
    console.log('[1/5] Dang tao file thuc thi (.exe)...');
    try {
        fs.copyFileSync(process.execPath, targetExe);
        console.log('   ✅ Da tao: ' + exeName);
    } catch (err) {
        console.error('   ❌ Loi khi tao file EXE:', err.message);
        process.exit(1);
    }

    // 2. SEA Injection (postject)
    console.log('[2/5] Dang nhung du lieu core (SEA Injection)...');
    try {
        const postjectCmd = `npx postject "${targetExe}" NODE_SEA_BLOB "${seaBlob}" --sentinel-fuse ${sentinel}`;
        execSync(postjectCmd, { stdio: 'inherit' });
        console.log('   ✅ Da nhung du lieu core thanh cong.');
    } catch (err) {
        console.error('   ❌ Loi khi nhung SEA Blob:', err.message);
        process.exit(1);
    }

    // 3. Chuyen doi bieu tuong (Icon) - DUNG TRUC TIEP ANH CUA DONG CHI
    console.log('[3/5] Dang xử lý bieu tuong (Icon) - Lay truc tiep tu file cua dong chi...');
    const pngPath = path.join(rootDir, 'icon.png');
    const icoPath = path.join(rootDir, 'icon.ico');

    if (fs.existsSync(pngPath)) {
        try {
            const pngBuf = fs.readFileSync(pngPath);
            const head = Buffer.from([0,0,1,0,1,0]);
            const dir = Buffer.alloc(16);
            dir.writeUInt8(0, 0); dir.writeUInt8(0, 1); dir.writeUInt8(0, 2); dir.writeUInt8(0, 3);
            dir.writeUInt16LE(1, 4); dir.writeUInt16LE(32, 6);
            dir.writeUInt32LE(pngBuf.length, 8); dir.writeUInt32LE(22, 12);

            fs.writeFileSync(icoPath, Buffer.concat([head, dir, pngBuf]));
            fs.copyFileSync(icoPath, path.join(distDir, 'icon.ico'));
            console.log('   ✅ DA LAY TRUC TIEP VA TAO: icon.ico');
        } catch (err) {
            console.warn('   ⚠️ Khong the tao icon.ico tu png, bo qua.');
        }
    } else if (fs.existsSync(icoPath)) {
        fs.copyFileSync(icoPath, path.join(distDir, 'icon.ico'));
        console.log('   ✅ Da co san icon.ico, dang chep vao dist...');
    } else {
        console.log('   ⚠️ Khong thay file icon, su dung bieu tuong mac dinh.');
    }

    // 4. Chep thu vien va tai nguyen (node_modules, zip du phong)
    console.log('[4/5] Dang chep thu vien vao dist (vui long doi)...');
    const srcModules = path.join(rootDir, 'node_modules');
    const distModules = path.join(distDir, 'node_modules');
    if (fs.existsSync(srcModules)) {
        try {
            // Dung fs.cpSync (Native Node.js) de dam bao do tin cay tuyet doi
            fs.cpSync(srcModules, distModules, { recursive: true, force: true });
            console.log('   ✅ Da chep xong node_modules (Native Copy).');
        } catch (err) {
            console.error('   ❌ Loi khi chep node_modules:', err.message);
            process.exit(1);
        }
    }
    const nodeModulesZip = path.join(rootDir, 'node_modules.zip');
    if (fs.existsSync(nodeModulesZip)) {
        fs.copyFileSync(nodeModulesZip, path.join(distDir, 'node_modules.zip'));
        console.log('   ✅ Da chep: node_modules.zip');
    }

    // 5. Nen Release vao build_version
    console.log('[5/5] Dang nen ban Release vao build_version...');
    const buildVersionDir = path.join(rootDir, 'build_version');
    if (!fs.existsSync(buildVersionDir)) fs.mkdirSync(buildVersionDir, { recursive: true });

    const now = new Date();
    const ts = now.getFullYear().toString() + (now.getMonth() + 1).toString().padStart(2, '0') +
        now.getDate().toString().padStart(2, '0') + '_' +
        now.getHours().toString().padStart(2, '0') +
        now.getMinutes().toString().padStart(2, '0') +
        now.getSeconds().toString().padStart(2, '0');
    
    const zipName = `snp_sync_${ts}.zip`;
    const zipPath = path.join(buildVersionDir, zipName);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    console.log(`   🚀 DANG NEN: ${zipName}... (KHONG DUOC MO FILE)`);

    return new Promise((resolve, reject) => {
        archive.on('progress', (data) => {
            const bytes = (data.fs.processedBytes / 1024 / 1024).toFixed(2);
            process.stdout.write(`\r      > Dang xu ly: ${data.entries.processed} tệp (${bytes} MB)...    `);
        });

        output.on('close', () => {
            console.log('\n');
            console.log('✅ HOAN TAT MOI THU!');
            console.log('------------------------------------------------------');
            console.log(`📍 VI TRI FILE RELEASE: ${zipPath}`);
            console.log(`📦 DUNG LUONG PHIEN BAN: ${(archive.pointer() / 1024 / 1024).toFixed(2)} MB`);
            console.log('------------------------------------------------------');
            setTimeout(resolve, 1000);
        });

        archive.on('error', err => {
            console.error('   ❌ Loi khi nen:', err.message);
            reject(err);
        });

        archive.pipe(output);
        archive.directory(distDir, 'snp_sync');
        archive.finalize();
    });
}

/**
 * TU DONG TAO SHORTCUT RA DESKTOP NGAY KHI BUILD XONG
 * Giup dong chi kiem tra ngay lap tuc sau khi build.
 */
async function createBuildShortcut() {
    console.log('[6/5] Dang "de" phiem tat ra Desktop cho dong chi...');
    const rootDir = path.join(__dirname, '..');
    const distDir = path.join(rootDir, 'dist');
    const exePath = path.join(distDir, 'SNP - DONG BO DU LIEU.exe');
    const iconPath = path.join(distDir, 'icon.ico');
    const psPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

    // Tao file PS1 tam thoi de xu ly triet de Tieng Viet (Dung BOM de PS luon nhan dung UTF8)
    const tempPs = path.join(require('os').tmpdir(), `build_shortcut_${Date.now()}.ps1`);
    const safeExePath = exePath.replace(/\\/g, '\\\\');
    const safeDistDir = distDir.replace(/\\/g, '\\\\');
    const safeIconPath = iconPath.replace(/\\/g, '\\\\');

    const psScriptContent = `
        $desktop = [Environment]::GetFolderPath('Desktop');
        $path = Join-Path $desktop 'SNP - DONG BO DU LIEU.lnk';
        if (Test-Path $path) { Remove-Item $path -Force }
        $ws = New-Object -ComObject WScript.Shell;
        $s = $ws.CreateShortcut($path);
        $s.TargetPath = '${safeExePath}';
        $s.WorkingDirectory = '${safeDistDir}';
        if (Test-Path '${safeIconPath}') { $s.IconLocation = '${safeIconPath},0'; }
        $s.Save();
    `.replace(/\n/g, '\r\n').trim();

    try {
        require('fs').writeFileSync(tempPs, '\ufeff' + psScriptContent, { encoding: 'utf8' });
        execSync(`"${psPath}" -ExecutionPolicy Bypass -File "${tempPs}"`);
        try { if (require('fs').existsSync(tempPs)) require('fs').unlinkSync(tempPs); } catch(e) {}
        console.log('   ✅ DA SINH PHIEM TAT NGOAI DESKTOP! Moi dong chi ra nhan hang.');
    } catch (err) {
        console.warn('   ⚠️ Khong the tao shortcut ngoai Desktop:', err.message);
    }
}

async function run() {
    await postBuild();
    await createBuildShortcut();
}

run().catch(err => {
    console.error('❌ CHUONG TRINH THAT BAI:', err.message);
    process.exit(1);
});

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

/**
 * Script nen thu muc dist thanh file zip voi timestamp
 * Luu vao thu muc build_version
 */
async function zipDist() {
    const buildDir = path.join(__dirname, '..', 'build_version');
    const distDir = path.join(__dirname, '..', 'dist');

    // 1. Tao thu muc build_version neu chua co
    if (!fs.existsSync(buildDir)) {
        fs.mkdirSync(buildDir, { recursive: true });
        console.log('📁 Da tao thu muc build_version');
    }

    // 2. Tao timestamp: YYYYMMDD_HHMMSS
    const now = new Date();
    const timestamp = now.getFullYear().toString() +
        (now.getMonth() + 1).toString().padStart(2, '0') +
        now.getDate().toString().padStart(2, '0') + '_' +
        now.getHours().toString().padStart(2, '0') +
        now.getMinutes().toString().padStart(2, '0') +
        now.getSeconds().toString().padStart(2, '0');

    const zipFileName = `snp_sync_${timestamp}.zip`;
    const zipFilePath = path.join(buildDir, zipFileName);

    console.log(`🚀 BAT DAU NEN: ${zipFileName}...`);
    console.log('⚠️  CANH BAO: VUI LONG DOI DEN KHI HIEN CHU [✅ HOAN TAT].');
    console.log('   (Dung mo file Zip luc nay vi se bi bao loi Corrupt)');

    const output = fs.createWriteStream(zipFilePath);
    const archive = archiver('zip', {
        zlib: { level: 6 } // Muc nen tieu chuan, tuong thich tot hon
    });

    return new Promise((resolve, reject) => {
        // Theo doi tien do thoi gian thuc
        archive.on('progress', (data) => {
            const entries = data.entries.processed;
            const bytes = (data.fs.processedBytes / 1024 / 1024).toFixed(2);
            process.stdout.write(`\r   > Dang xu ly: ${entries} tệp (${bytes} MB)...    `);
        });

        // Su kien khi file da duoc ghi hoan tat va dong lai
        output.on('close', () => {
            console.log('\n');
            const sizeMB = (archive.pointer() / 1024 / 1024).toFixed(2);
            console.log(`✅ HOAN TAT VIEC GHI FILE!`);
            console.log(`📍 File Release: ${zipFilePath}`);
            console.log(`📦 Dung luong cuoi cung: ${sizeMB} MB`);
            // Cho mot chut de he thong flush file
            setTimeout(resolve, 500);
        });

        // Su kien khi archive da ket thuc nung
        archive.on('finish', () => {
            console.log('🏁 Dang dong goi du lieu...');
        });

        archive.on('warning', (err) => {
            if (err.code === 'ENOENT') {
                console.warn('⚠️ Canh bao:', err);
            } else {
                reject(err);
            }
        });

        archive.on('error', (err) => {
            console.error('❌ Loi phat sinh trong luc nen:', err);
            reject(err);
        });

        archive.pipe(output);

        // Them thu muc dist vao zip, dat ten thu muc goc ben trong la snp_sync
        archive.directory(distDir, 'snp_sync');

        // Bat dau finalize
        archive.finalize();
    });
}

zipDist().catch(err => {
    console.error('❌ LOI KHI NEN:', err.message);
    process.exit(1);
});

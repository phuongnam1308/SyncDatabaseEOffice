const fs = require('fs');
const path = require('path');

function copyRecursiveSync(src, dest) {
    const exists = fs.existsSync(src);
    const stats = exists && fs.statSync(src);
    const isDirectory = exists && stats.isDirectory();
    if (isDirectory) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        fs.readdirSync(src).forEach(function(childItemName) {
            copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
        });
    } else {
        fs.copyFileSync(src, dest);
    }
}

const distNodeModules = path.join(__dirname, '../dist/node_modules');
const srcNodeModules = path.join(__dirname, '../node_modules');

console.log('🚀 Dang chep thu vien node_modules vao dist (vui long doi...)...');
if (!fs.existsSync(srcNodeModules)) {
    console.error('❌ Khong tim thay thu muc node_modules goc!');
    process.exit(1);
}

try {
    // Chi chep cac thu vien can thiet de tiet kiem dung luong neu muon, 
    // nhung hien tai ta chep het cho chac chan theo y dong chi.
    copyRecursiveSync(srcNodeModules, distNodeModules);
    console.log('✅ Da chep xong node_modules vao dist!');
} catch (err) {
    console.error('❌ Loi khi chep thu vien:', err.message);
    process.exit(1);
}

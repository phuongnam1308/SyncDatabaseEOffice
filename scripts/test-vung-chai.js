const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * MOCK SERVER LOGIC (Giong hệt index.js moi)
 */
console.log('⚓ CHUONG TRINH KIEM TRA TINH VUNG CHAI 🛡️');
console.log('==========================================');

// Bo bay loi kieu moi (Gia co)
process.on('uncaughtException', (err) => {
  console.error('\n❌ [LOI] Nhung he thong VAN SONG de dong chi kiem tra!');
  console.error(err.message);
});

console.log('[1/3] Dang tim kiem Google Chrome...');
const chromePaths = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
];

let chromeExec = null;
for (const p of chromePaths) {
  if (fs.existsSync(p)) {
    chromeExec = p;
    break;
  }
}

if (chromeExec) {
  console.log(`✅ Da tim thay Chrome tai: ${chromeExec}`);
  console.log('[2/3] Dang mo thu mot trang web bang Chrome...');
  exec(`start "" "${chromeExec}" "https://google.com"`);
} else {
  console.warn('⚠️ Khong tim thay Chrome, se dung trinh duyet mac dinh.');
  exec(`start "" "https://google.com"`);
}

console.log('\n[3/3] ⚡ THU THACH DO BEN ⚡');
console.log('------------------------------------------');
console.log('👉 BUOC 1: Dong trinh duyet vua hien len.');
console.log('👉 BUOC 2: An phim ENTER lien tuc vao day.');
console.log('------------------------------------------');
console.log('=> Neu Terminal nay KHONG DONG, nghia la chung ta da CHIEN THANG! 🏆');

// Giu cho process luon song ma khong can stdin
setInterval(() => {
    // Chi don gian la giu process ton tai
}, 10000);

// Thong bao khi co input (nhung ko thoat)
process.stdin.resume();
process.stdin.on('data', (data) => {
    console.log(`🎯 Dong chi vua an: ${JSON.stringify(data.toString())} -> NHUNG TOI VAN SONG! 😂`);
});

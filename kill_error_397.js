const fs = require('fs');
const file = 'src/sync-news-aspx-page/migrate/HtmlFileMigrationModel.js';
let lines = fs.readFileSync(file, 'utf8').split('\n');

// Xóa tất cả các dòng chứa "] Lỗi chèn DB" và các dòng có dấu } dư thừa ngay bên dưới nó
let newLines = [];
let skipNext = 0;

for (let i = 0; i < lines.length; i++) {
    if (skipNext > 0) {
        skipNext--;
        continue;
    }
    
    // Nếu gặp dòng rác
    if (lines[i].includes('] Lỗi chèn DB') || lines[i].includes('e.message') && !lines[i].includes('logger')) {
        console.log('[+] Đã tìm thấy và cắt bỏ dòng rác:', lines[i].trim());
        // Bỏ thêm 2 dấu ngoặc đóng thừa phía dưới
        if (lines[i+1] && lines[i+1].trim() === '}') skipNext++;
        if (lines[i+2] && lines[i+2].trim() === '}') skipNext++;
        continue;
    }
    
    newLines.push(lines[i]);
}

// Write back
fs.writeFileSync(file, newLines.join('\n'), 'utf8');
console.log('[+] Cắt bỏ dòng rác thành công. Vui lòng bấm lưu file lại (nếu đang ở VSCode) và kiểm tra Nodemon!');

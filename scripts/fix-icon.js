const fs = require('fs');
const path = require('path');

/**
 * MA THUAT ICON: Bien icon.png thanh icon.ico chuan Windows
 * Ky thuat: Dong goi du lieu PNG vao trong cau truc ICO
 */
function createIcoFromPng() {
    const pngPath = path.join(__dirname, '..', 'icon.png');
    const icoPath = path.join(__dirname, '..', 'icon.ico');

    if (!fs.existsSync(pngPath)) {
        console.warn('⚠️ Khong tim thay file icon.png de chuyen doi. Bo qua buoc nay.');
        return;
    }

    try {
        const pngBuffer = fs.readFileSync(pngPath);
        const pngSize = pngBuffer.length;

        // --- CAU TRUC ICO (Single Image PNG) ---
        
        // 1. Header (6 bytes)
        const header = Buffer.alloc(6);
        header.writeUInt16LE(0, 0); // Reserved
        header.writeUInt16LE(1, 2); // Type 1 (Icon)
        header.writeUInt16LE(1, 4); // Count 1 (Số lượng ảnh)

        // 2. Directory Entry (16 bytes)
        const dir = Buffer.alloc(16);
        dir.writeUInt8(0, 0);       // Width (0 = 256px)
        dir.writeUInt8(0, 1);       // Height (0 = 256px)
        dir.writeUInt8(0, 2);       // Colors (0 = true color)
        dir.writeUInt8(0, 3);       // Reserved
        dir.writeUInt16LE(1, 4);    // Color Planes
        dir.writeUInt16LE(32, 6);   // BPP (Bits per pixel)
        dir.writeUInt32LE(pngSize, 8); // Kích thước dữ liệu ảnh
        dir.writeUInt32LE(22, 12);     // Vị trí bắt đầu dữ liệu (6 header + 16 dir = 22)

        // 3. Hop nhat tat ca du lieu
        const icoBuffer = Buffer.concat([header, dir, pngBuffer]);

        fs.writeFileSync(icoPath, icoBuffer);
        console.log(`✅ DA PHU PHEP THANH CONG!`);
        console.log(`📍 File moi: ${icoPath}`);
        console.log(`✨ Kich thuoc dong goi: ${(icoBuffer.length / 1024 / 1024).toFixed(2)} MB`);
    } catch (err) {
        console.error('❌ Loi trong luc tao icon:', err.message);
    }
}

createIcoFromPng();

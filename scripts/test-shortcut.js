const { execSync, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// Gia lap viec tao shortcut giong het nhu trong bộ máy Build
const shortcutName = 'SNP - TEST SHORTCUT.lnk';
const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const exePath = path.join(distDir, 'SNP - DONG BO DU LIEU.exe');
const iconPath = path.join(distDir, 'icon.ico');

console.log('🚀 Dang thu nghiem "ma thuat" tao Shortcut co Mo neo vang...');

// TIEU CHUAN: Neu co icon.png thi tu dong resize de Windows luon nhan dang
const pngPath = path.join(rootDir, 'icon.png');
const psPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

if (fs.existsSync(pngPath)) {
    console.log('   📸 Dang nén mỏ neo vàng về chuẩn 256x256 (Siêu nhẹ)...');
    try {
        const psResize = `
            Add-Type -AssemblyName System.Drawing;
            $img = [System.Drawing.Image]::FromFile('${pngPath}');
            $bmp = New-Object System.Drawing.Bitmap(256, 256);
            $g = [System.Drawing.Graphics]::FromImage($bmp);
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic;
            $g.DrawImage($img, 0, 0, 256, 256);
            $bmp.Save('${iconPath}', [System.Drawing.Imaging.ImageFormat]::Icon);
            $g.Dispose(); $img.Dispose(); $bmp.Dispose();
        `.replace(/\n/g, ' ').trim();
        execSync(`"${psPath}" -ExecutionPolicy Bypass -Command "${psResize}"`);
    } catch (e) {
        console.warn('   ⚠️ Khong the tu dong nén, dang dung file hien co.');
    }
}

const psCommand = `
    $desktop = [Environment]::GetFolderPath('Desktop');
    $path = Join-Path $desktop '${shortcutName}';
    if (Test-Path $path) { Remove-Item $path -Force }
    $ws = New-Object -ComObject WScript.Shell;
    $s = $ws.CreateShortcut($path);
    $s.TargetPath = '${exePath}';
    $s.WorkingDirectory = '${distDir}';
    if (Test-Path '${iconPath}') { $s.IconLocation = '${iconPath},0'; }
    $s.Save();
    Write-Host "[OK] Phiem tat da duoc ghi vao: $desktop"
`.replace(/\n/g, ' ').trim();

exec(`"${psPath}" -ExecutionPolicy Bypass -Command "${psCommand}"`, (err, stdout) => {
    if (err) {
        console.error('❌ Loi khi tao shortcut:', err.message);
    } else {
        console.log(stdout);
        console.log('✨ THANH CONG! Dong chi hay ra Desktop tim file: ' + shortcutName);
    }
});

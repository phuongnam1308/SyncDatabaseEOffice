const { exec } = require('child_process');
const path = require('path');

// Gia lap viec tao shortcut giong het nhu trong EXE
const shortcutName = 'SNP - TEST SHORTCUT.lnk';
const exePath = path.join(__dirname, '..', 'dist', 'SNP - DONG BO DU LIEU.exe');
const exeDir = path.dirname(exePath);
const iconPath = path.join(exeDir, 'icon.ico');

console.log('🚀 Dang thu nghiem "ma thuat" tao Shortcut ra Desktop...');

const psCommand = `
    $desktop = [Environment]::GetFolderPath('Desktop');
    $path = Join-Path $desktop '${shortcutName}';
    $ws = New-Object -ComObject WScript.Shell;
    $s = $ws.CreateShortcut($path);
    $s.TargetPath = '${exePath}';
    $s.WorkingDirectory = '${exeDir}';
    if (Test-Path '${iconPath}') { $s.IconLocation = '${iconPath}'; }
    $s.Save();
    Write-Host "[OK] Phiem tat da duoc ghi vao: $desktop"
`.replace(/\n/g, ' ').trim();

const psPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

exec(`"${psPath}" -ExecutionPolicy Bypass -Command "${psCommand}"`, (err, stdout) => {
    if (err) {
        console.error('❌ Loi khi tao shortcut:', err.message);
    } else {
        console.log(stdout);
        console.log('✨ THANH CONG! Dong chi hay ra Desktop tim file: ' + shortcutName);
    }
});

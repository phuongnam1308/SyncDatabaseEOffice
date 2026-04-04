@echo off
setlocal enabledelayedexpansion

:: ======================================================
::   SNP - ĐỒNG BỘ DỮ LIỆU: BỘ CÀI ĐẶT NHANH
:: ======================================================

set "TARGET_DIR=C:\SNP_DongBoDuLieu"
set "EXE_NAME=SNP - DONG BO DU LIEU.exe"
set "SHORTCUT_NAME=SNP - DONG BO DU LIEU.lnk"

echo 🚢 Dang chuan bi cai dat he thong...
echo(

:: 1. Kiem tra quyen Admin
echo [+] Dang kiem tra quyen quan tri...
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [LOI] Vui long chay file nay bang quyen "Run as administrator"^^!
    pause
    exit /b
)
echo [OK] Quyen Admin hop le.

:: 2. Tao thu muc dich
echo [+] Dang chuan bi thu muc: %TARGET_DIR%
if not exist "%TARGET_DIR%" (
    mkdir "%TARGET_DIR%"
)

:: 3. Sao chep toan bo file vao o C
echo [+] Dang sao chep du lieu (vui long doi)...
xcopy /E /I /Y "%~dp0*" "%TARGET_DIR%\" >nul
if %errorLevel% neq 0 (
    echo [LOI] Sao chep du lieu that bai.
    pause
    exit /b
)
echo [OK] Da sao chep xong du lieu vao %TARGET_DIR%.

:: 4. Tao file VBS de chay an (Background Process)
echo [+] Dang setup che do chay an...
(
echo Set WshShell = CreateObject("WScript.Shell"^)
echo WshShell.Run chr(34^) ^& "%TARGET_DIR%\%EXE_NAME%" ^& chr(34^), 0
echo Set WshShell = Nothing
) > "%TARGET_DIR%\run_hidden.vbs"

:: Tu dong chon icon: Uu tien .ico, sau do den .png
if exist "%~dp0icon.ico" (
    set "ICON_FILE=icon.ico"
) else if exist "%~dp0icon.png" (
    set "ICON_FILE=icon.png"
) else (
    set "ICON_FILE="
)

if defined ICON_FILE (
    set "ICON_PATH=%TARGET_DIR%\%ICON_FILE%"
) else (
    set "ICON_PATH="
)

:: 5. Tao Shortcut ra Desktop bang PowerShell
echo [+] Dang tao Shortcut ra Desktop...
set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

if exist "%PS_EXE%" (
    :: Shortcut Mac dinh
    "%PS_EXE%" -ExecutionPolicy Bypass -Command "$desktop = [Environment]::GetFolderPath('Desktop'); $ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut(\"$desktop\%SHORTCUT_NAME%\"); $s.TargetPath = \"%TARGET_DIR%\%EXE_NAME%\"; $s.WorkingDirectory = \"%TARGET_DIR%\"; $s.IconLocation = \"%ICON_PATH%\"; $s.Save(); Write-Host \"[OK] Phiem tat chinh da ghi vao: $desktop\""
    echo [OK] Da tao shortcut chinh: %SHORTCUT_NAME%
    
    :: Shortcut Chay Ngam
    "%PS_EXE%" -ExecutionPolicy Bypass -Command "$desktop = [Environment]::GetFolderPath('Desktop'); $ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut(\"$desktop\SNP - DONG BO (CHAY NGAM).lnk\"); $s.TargetPath = \"wscript.exe\"; $s.Arguments = \"'%TARGET_DIR%\run_hidden.vbs'\"; $s.WorkingDirectory = \"%TARGET_DIR%\"; $s.IconLocation = \"%ICON_PATH%\"; $s.Save()"
    echo [OK] Da tao shortcut chay ngam.

    echo [OK] Da cap nhat Shortcut ngoai Desktop voi bieu tuong: %ICON_FILE%.
    
    :: Tu dong bat Desktop de kiem tra
    explorer.exe shell:Desktop
) else (
    echo [LOI] Khong tim thay PowerShell tai %PS_EXE%
)

echo(
echo ======================================================
echo   ⚓ CAI DAT THANH CONG!
echo.
echo   - Thu muc: %TARGET_DIR%
echo   - Shortcut: Da nam ngoai Desktop
echo   - Dia chi: http://localhost:3021
echo ======================================================
echo.
pause

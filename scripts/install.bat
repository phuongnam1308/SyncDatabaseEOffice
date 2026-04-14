@echo off
setlocal

:: ======================================================
::   SNP SYNC: INSTALLER (ULTRA STABLE 2.0 - NO PATH)
:: ======================================================

:: Tu dong xac dinh duong dan he thong
set "SYS_DIR=%SystemRoot%\System32"
set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "XCOPY_EXE=%SystemRoot%\System32\xcopy.exe"
set "EXP_EXE=%SystemRoot%\explorer.exe"
set "CMD_EXE=%SystemRoot%\System32\cmd.exe"

set "TARGET_DIR=C:\SNP_DongBoDuLieu"
set "EXE_NAME=SNP - DONG BO DU LIEU.exe"
set "SHORTCUT_NAME=SNP - DONG BO DU LIEU.lnk"

echo [+] Checking Administrator rights...
"%SYS_DIR%\net.exe" session >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Requesting Admin privileges...
    if exist "%PS_EXE%" (
        "%PS_EXE%" -Command "Start-Process '%~f0' -Verb RunAs"
    )
    exit /b
)
echo [OK] Admin rights confirmed.

echo [+] Preparing directory: %TARGET_DIR%
if not exist "%TARGET_DIR%" "%CMD_EXE%" /c mkdir "%TARGET_DIR%"

echo [+] Copying files (Please wait)...
if exist "%XCOPY_EXE%" (
    "%XCOPY_EXE%" /E /I /Y "%~dp0*" "%TARGET_DIR%\" >nul
) else (
    echo [ERROR] XCOPY not found.
)
echo [OK] Files copied to %TARGET_DIR%.

:: Create VBS for hidden run
(
echo Set WshShell = CreateObject("WScript.Shell"^)
echo WshShell.Run chr(34^) ^& "%TARGET_DIR%\%EXE_NAME%" ^& chr(34^), 0
echo Set WshShell = Nothing
) > "%TARGET_DIR%\run_hidden.vbs"

echo [+] Creating Shortcut with Golden Anchor...

:: DUNG POWERSHELL VOI DUONG DAN TUYET DOI
set "PS_CMD=$s=[Environment]::GetFolderPath('Desktop'); $p=Join-Path $s '%SHORTCUT_NAME%'; if(Test-Path $p){Remove-Item $p -Force}; $w=New-Object -ComObject WScript.Shell; $sc=$w.CreateShortcut($p); $sc.TargetPath='%TARGET_DIR%\%EXE_NAME%'; $sc.WorkingDirectory='%TARGET_DIR%'; if(Test-Path '%TARGET_DIR%\icon.ico'){$sc.IconLocation='%TARGET_DIR%\icon.ico,0'}; $sc.Save(); Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('CAI DAT THANH CONG!', 'SNP Sync', 'OK', 'Information');"

if exist "%PS_EXE%" (
    "%PS_EXE%" -ExecutionPolicy Bypass -Command "%PS_CMD%"
)

echo [OK] Installation completed successfully!
if exist "%EXP_EXE%" (
    "%EXP_EXE%" shell:Desktop
)

echo(
echo ======================================================
echo   SNP SYNC - READY!
echo ======================================================
echo(
pause

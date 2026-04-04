@echo off
setlocal enabledelayedexpansion

:: ======================================================
::   SNP - ĐỒNG BỘ DỮ LIỆU: THIẾT LẬP TÊN MIỀN
:: ======================================================

set "HOSTS_FILE=%SystemRoot%\System32\drivers\etc\hosts"
set "IP_ENTRY=127.0.0.1"
set "DOMAIN_ENTRY=SNP-DongBoDuLieu"

echo ======================================================
echo   DANG THIET LAP TEN MIEN: %DOMAIN_ENTRY%
echo ======================================================

:: 1. Kiem tra quyen Admin
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [LOI] Vui long chay file nay bang quyen "Run as administrator"^^!
    pause
    exit /b
)
echo [OK] Dang chay voi quyen Admin.
echo(

:: 2. Kiem tra neu ten mien da ton tai
findstr /i /c:"%DOMAIN_ENTRY%" "%HOSTS_FILE%" >nul
if %errorLevel% equ 0 (
    echo [THONG BAO] Ten mien %DOMAIN_ENTRY% da duoc thiet lap truoc do.
) else (
    echo [DANG XU LY] Dang them %DOMAIN_ENTRY% vao file hosts...
    echo %IP_ENTRY% %DOMAIN_ENTRY% >> "%HOSTS_FILE%"
    if %errorLevel% equ 0 (
        echo [THANH CONG] Da them %DOMAIN_ENTRY% vao file hosts.
    ) else (
        echo [LOI] Khong the ghi vao file hosts. Vui long kiem tra phan mem diet virus.
    )
)

echo(
echo Bay gio ban co the truy cap Dashboard tai: http://%DOMAIN_ENTRY%:3021/api/sync-manager-src/dashboard
echo(
pause

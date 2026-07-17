@echo off
setlocal enabledelayedexpansion

echo ========================================================
echo BAT DAU DONG BO DU LIEU - SYNC INCOMING V2
echo ========================================================

:: ========== CAU HINH CHINH ==========
:: So luong worker chay song song
set WORKER_COUNT=6

:: Dieu khien gioi han moi worker
:: - 0 = unlimited (chay den khi het staging tren khoang cua worker)
:: - >0 = gioi han so ban ghi toi da moi worker
set MAX_PER_WORKER=10000

:: Khoi tao ID bat dau quet tu day
:: - Mac dinh: 1
:: - Hoac truyen tham so vao .bat: run_sync_loop.bat 1000
set START_ID=%140000%
if "%START_ID%"=="" set START_ID=140000

:: Khong phai chinh sua o day - chi dung de trong vong lap
set BATCH_COUNT=1

echo [CAU HINH] WORKER_COUNT: %WORKER_COUNT%
echo [CAU HINH] START_ID: %START_ID%
if %MAX_PER_WORKER%==0 (
    echo [CAU HINH] MAX_PER_WORKER: unlimited (sync den khi het staging)
) else (
    echo [CAU HINH] MAX_PER_WORKER: %MAX_PER_WORKER% ban ghi
)
echo.

:loop
echo ========================================================
echo [ME %BATCH_COUNT%] Dang chay dong bo...
set WORKER_COUNT=%WORKER_COUNT%
set MAX_PER_WORKER=%MAX_PER_WORKER%
node src\sync-incoming-documents\run_batch_workers.js --max=%MAX_PER_WORKER% --workers=%WORKER_COUNT% --start=%START_ID%

if %ERRORLEVEL% == 2 (
    echo [HOAN THANH] Khong con du lieu de dong bo. Ket thuc an toan.
    goto :end
)
if %ERRORLEVEL% == 1 (
    echo [LOI] Co loi nghiem trong, ngung kich ban.
    goto :end
)

echo [ME %BATCH_COUNT%] Xong. Nghi 1 giay...
timeout /t 1 /nobreak >nul

set /a BATCH_COUNT=!BATCH_COUNT! + 1
goto :loop

:end
echo ========================================================
echo CHUONG TRINH CHAY HOAN TAT
echo ========================================================
pause
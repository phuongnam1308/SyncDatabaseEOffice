@echo off
setlocal enabledelayedexpansion

echo ========================================================
echo BAT DAU DONG BO DU LIEU - SYNC INCOMING V2
echo ========================================================

:: ========== CAU HINH CHINH ==========
:: So luong worker chay song song
set WORKER_COUNT=3

:: Dieu khien gioi han moi worker
:: - 0 = unlimited (chay den khi het staging tren khoang cua worker)
:: - >0 = gioi han so ban ghi toi da moi worker
set MAX_PER_WORKER=50

:: Khong phai chinh sua o day - chi dung de trong vong lap
set BATCH_COUNT=1

echo [CAU HINH] WORKER_COUNT: %WORKER_COUNT%
if %MAX_PER_WORKER%==0 (
    echo [CAU HINH] MAX_PER_WORKER: unlimited (sync den khi het staging)
) else (
    echo [CAU HINH] MAX_PER_WORKER: %MAX_PER_WORKER% ban ghi
)
echo.

set BATCH_COUNT=1

:loop
echo ========================================================
echo [ME %BATCH_COUNT%] Dang chay dong bo...
set WORKER_COUNT=%WORKER_COUNT%
set MAX_PER_WORKER=%MAX_PER_WORKER%
node src\sync-incoming-v2\run_test_batch_workers.js --max=%MAX_PER_WORKER% --workers=%WORKER_COUNT%

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
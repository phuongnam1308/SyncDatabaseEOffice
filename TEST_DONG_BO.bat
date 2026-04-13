@echo off
echo ======================================================
echo   ⚓ SNP SYNC - KIEM TRA TINH VUNG CHAI 🛡️
echo ======================================================
echo.
echo [+] Dang khoi chay kich ban kiem tra...
echo.

:: Thiet lap moi truong gia lap san pham
set NODE_ENV=production

:: Chay script test vung chai
node scripts/test-vung-chai.js

echo.
echo ======================================================
echo   DONE! Moi dong chi xem ket qua tren Terminal.
echo ======================================================
pause

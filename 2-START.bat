@echo off
chcp 65001 >nul
cd /d "%~dp0"
title HR-Interview - Server

echo.
echo =========================================================
echo   HR-Interview  -  เริ่มใช้งานระบบ
echo =========================================================
echo.

REM ---------- Check installed ----------
if not exist "node_modules" (
    echo [X] ยังไม่ได้ติดตั้ง — รัน  1-INSTALL.bat  ก่อน
    echo.
    pause
    exit /b 1
)

set SECURE_COOKIES=true
set PORT=3000
set NODE_ENV=production
set AUTO_OPEN_BROWSER=true

echo เซิร์ฟเวอร์กำลังจะเริ่ม
echo.
echo URL สำหรับใช้งาน: http://localhost:3000
echo (เบราว์เซอร์จะเปิดอัตโนมัติประมาณ 1-2 วินาทีหลังเริ่ม)
echo.
echo ===============================================
echo   วิธีปิดเซิร์ฟเวอร์: กด Ctrl+C แล้วปิดหน้าต่างนี้
echo   ห้ามปิดหน้าต่างนี้ระหว่างใช้งาน
echo ===============================================
echo.

npm start

echo.
echo เซิร์ฟเวอร์หยุดทำงานแล้ว
pause

@echo off
chcp 65001 >nul
cd /d "%~dp0"
title HR-WWN — Install

echo.
echo =========================================================
echo   HR-WWN  —  ติดตั้งครั้งแรก (รันครั้งเดียวพอ)
echo =========================================================
echo.

REM ---------- Check Node.js ----------
where node >nul 2>nul
if errorlevel 1 (
    echo [X] ไม่พบโปรแกรม Node.js บนเครื่องนี้
    echo.
    echo คุณต้องติดตั้ง Node.js ก่อน:
    echo.
    echo    1. หน้าเว็บจะเปิดให้ดาวน์โหลด
    echo    2. คลิกปุ่ม "LTS" ดาวน์โหลดไฟล์ .msi
    echo    3. ดับเบิลคลิกไฟล์ที่ดาวน์โหลด แล้วกด Next ไปเรื่อยๆ จนเสร็จ
    echo    4. กลับมาดับเบิลคลิก 1-INSTALL.bat ไฟล์นี้อีกครั้ง
    echo.
    pause
    start https://nodejs.org/
    exit /b 1
)

echo [OK] พบ Node.js แล้ว
for /f "tokens=*" %%v in ('node --version') do echo      version: %%v
echo.

REM ---------- Install dependencies ----------
echo กำลังติดตั้งแพ็คเกจที่จำเป็น (ใช้เวลาประมาณ 1-3 นาที)
echo อย่าปิดหน้าต่างนี้จนกว่าจะเสร็จ...
echo.

call npm install
if errorlevel 1 (
    echo.
    echo [X] ติดตั้งล้มเหลว
    echo     อ่านข้อความสีแดงด้านบน เพื่อดูสาเหตุ
    echo     ถ้าไม่เข้าใจ ส่งภาพหน้าจอให้ทีม IT ของคุณ
    echo.
    pause
    exit /b 1
)

echo.
echo =========================================================
echo   [OK] ติดตั้งเสร็จเรียบร้อย!
echo =========================================================
echo.
echo ขั้นตอนต่อไป:
echo.
echo    1. ดับเบิลคลิก  2-START.bat  เพื่อเริ่มใช้งาน
echo    2. เบราว์เซอร์จะเปิดให้อัตโนมัติ
echo    3. Login ครั้งแรกใช้:
echo         Username: admin
echo         Password: JC2026!Init
echo    4. หลัง login ให้เปลี่ยนรหัสผ่านทันที (ที่หน้า Admin)
echo.
pause

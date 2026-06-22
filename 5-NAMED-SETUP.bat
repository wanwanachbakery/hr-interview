@echo off
chcp 65001 >nul
cd /d "%~dp0"
title HR-Interview - Named Tunnel Setup (one-time)

echo.
echo =========================================================
echo   HR-Interview  -  ตั้งค่า Tunnel แบบ URL ถาวร (ทำครั้งเดียว)
echo =========================================================
echo.
echo สิ่งที่ต้องมีก่อนเริ่ม:
echo   1. มี Cloudflare account แล้ว (สมัครฟรีที่ cloudflare.com)
echo   2. Domain ของคุณอยู่บน Cloudflare แล้ว
echo      (ถ้ายังอยู่ที่ registrar อื่น เช่น GoDaddy / Namecheap
echo       ต้องย้าย nameserver มา Cloudflare ก่อน - ฟรี)
echo   3. ติดตั้ง cloudflared แล้ว
echo.
pause

REM ---------- Check cloudflared ----------
where cloudflared >nul 2>nul
if errorlevel 1 (
    echo.
    echo [X] ยังไม่ได้ติดตั้ง cloudflared
    echo     กลับไปรัน 4-TUNNEL.bat ก่อนเพื่อติดตั้ง
    pause
    exit /b 1
)

echo.
echo ---------------------------------------------------------
echo  Step 1/4: Login Cloudflare
echo ---------------------------------------------------------
echo เบราว์เซอร์จะเปิดให้ login Cloudflare
echo เลือก domain ที่จะใช้ แล้วกด Authorize
echo เมื่อเสร็จ กลับมาที่หน้านี้ — มันจะไปต่อเองอัตโนมัติ
echo.
pause

cloudflared tunnel login
if errorlevel 1 (
    echo [X] Login ล้มเหลว
    pause
    exit /b 1
)

echo.
echo ---------------------------------------------------------
echo  Step 2/4: ตั้งชื่อ tunnel
echo ---------------------------------------------------------
echo ใช้ตัวอักษรอังกฤษล้วน + ขีดกลาง (a-z, 0-9, -)
echo ตัวอย่าง: hrwwn-companyA
echo.
set /p TUNNAME="ตั้งชื่อ tunnel: "
if "%TUNNAME%"=="" (
    echo [X] ต้องตั้งชื่อ
    pause
    exit /b 1
)

echo.
echo สร้าง tunnel "%TUNNAME%"...
cloudflared tunnel create %TUNNAME%
if errorlevel 1 (
    echo [X] สร้าง tunnel ล้มเหลว
    echo     ถ้า error บอกว่า "already exists" - ลองใช้ชื่ออื่น
    pause
    exit /b 1
)

echo.
echo ---------------------------------------------------------
echo  Step 3/4: ผูก URL กับ tunnel
echo ---------------------------------------------------------
echo URL ที่จะใช้ตอนเปิดเว็บ เช่น
echo     hr.mycompany.com
echo     app.yourdomain.co
echo (อย่าใส่ https:// นำหน้า)
echo.
set /p HOSTNAME="กรอก URL: "
if "%HOSTNAME%"=="" (
    echo [X] ต้องกรอก URL
    pause
    exit /b 1
)

echo.
echo เพิ่ม DNS record %HOSTNAME% -^> tunnel %TUNNAME% ...
cloudflared tunnel route dns %TUNNAME% %HOSTNAME%
if errorlevel 1 (
    echo [X] เพิ่ม DNS ล้มเหลว
    echo     ตรวจสอบ:
    echo       - %HOSTNAME% เป็น subdomain ของ domain ที่อยู่บน Cloudflare ไหม
    echo       - มี DNS record ของ subdomain นี้อยู่แล้วหรือไม่ - ลบทิ้งก่อนแล้วรันใหม่
    pause
    exit /b 1
)

echo.
echo ---------------------------------------------------------
echo  Step 4/4: เขียน config file
echo ---------------------------------------------------------
node scripts\_write-tunnel-config.js "%TUNNAME%" "%HOSTNAME%"
if errorlevel 1 (
    echo [X] เขียน config ล้มเหลว
    pause
    exit /b 1
)

echo.
echo =========================================================
echo   [OK] เสร็จเรียบร้อย!
echo =========================================================
echo.
echo URL ของคุณ: https://%HOSTNAME%
echo (อาจต้องรอ DNS propagate 1-5 นาทีก่อนใช้ได้ครั้งแรก)
echo.
echo วิธีใช้งานต่อไป:
echo   1. รัน  2-START.bat  เพื่อเปิดเซิร์ฟเวอร์
echo   2. รัน  4-TUNNEL.bat  - ตอนนี้จะใช้ URL ถาวรอัตโนมัติ
echo.
pause

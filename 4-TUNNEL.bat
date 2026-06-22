@echo off
chcp 65001 >nul
cd /d "%~dp0"
title HR-Interview - Online Tunnel

echo.
echo =========================================================
echo   HR-Interview  -  เปิดให้คนนอกใช้งานผ่าน Internet
echo =========================================================
echo.

REM ---------- Check cloudflared ----------
where cloudflared >nul 2>nul
if errorlevel 1 (
    echo [X] ยังไม่ได้ติดตั้ง cloudflared
    echo.
    echo วิธีติดตั้ง:
    echo.
    echo   วิธีที่ 1: เปิด PowerShell แบบ Administrator แล้วรัน
    echo             winget install Cloudflare.cloudflared
    echo.
    echo   วิธีที่ 2: ดาวน์โหลด .msi ที่หน้าเว็บที่จะเปิดให้
    echo             ติดตั้ง แล้วกลับมาเปิด 4-TUNNEL.bat อีกครั้ง
    echo.
    pause
    start https://github.com/cloudflare/cloudflared/releases/latest
    exit /b 1
)

REM ---------- Check server running ----------
echo กำลังตรวจสอบเซิร์ฟเวอร์ที่ http://localhost:3000 ...
curl -s -o nul -w "%%{http_code}" http://localhost:3000/login >nul 2>nul
if errorlevel 1 (
    echo.
    echo [!] เซิร์ฟเวอร์ HR-Interview ยังไม่ได้รัน
    echo     เปิด  2-START.bat  ก่อน แล้วค่อยมาเปิด 4-TUNNEL.bat
    echo.
    pause
    exit /b 1
)
echo [OK] เซิร์ฟเวอร์ทำงานอยู่
echo.

REM ---------- Auto-detect: named tunnel (config exists) or quick tunnel ----------
if exist "%USERPROFILE%\.cloudflared\config.yml" (
    echo =========================================================
    echo   Named Tunnel (URL ถาวรของคุณ)
    echo =========================================================
    echo.
    echo พบ config ที่ %USERPROFILE%\.cloudflared\config.yml
    echo URL ของคุณจะตามที่ตั้งไว้ใน config นั้น (ไม่เปลี่ยน)
    echo.
    echo ห้ามปิดหน้าต่างนี้! ถ้าปิด ลูกค้าจะเข้าไม่ได้
    echo.
    cloudflared tunnel --config "%USERPROFILE%\.cloudflared\config.yml" run
) else (
    echo =========================================================
    echo   Quick Tunnel (URL ชั่วคราว - เปลี่ยนทุกครั้งที่รันใหม่)
    echo =========================================================
    echo.
    echo อยากให้ URL คงที่? รัน  5-NAMED-SETUP.bat  ก่อน
    echo (ต้องมี domain อยู่บน Cloudflare)
    echo.
    echo จะมี URL ขึ้นในไม่กี่วินาที ส่งให้ลูกค้าได้เลย
    echo ห้ามปิดหน้าต่างนี้! ถ้าปิด ลูกค้าจะเข้าไม่ได้
    echo.
    cloudflared tunnel --url http://localhost:3000
)

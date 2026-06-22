@echo off
chcp 65001 >nul
cd /d "%~dp0"
title HR-Interview — Backup

echo.
echo =========================================================
echo   HR-Interview  —  สำรองข้อมูล (Backup)
echo =========================================================
echo.

REM Build timestamp: YYYY-MM-DD_HH-MM
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value ^| find "="') do set DT=%%I
set TIMESTAMP=%DT:~0,4%-%DT:~4,2%-%DT:~6,2%_%DT:~8,2%-%DT:~10,2%
set BACKUP_DIR=backup\%TIMESTAMP%

echo กำลังสำรองไปที่: %BACKUP_DIR%
echo.

mkdir "%BACKUP_DIR%" 2>nul

xcopy /E /I /Y /Q "data" "%BACKUP_DIR%\data" >nul
if errorlevel 1 (
    echo [X] สำรอง data\ ล้มเหลว
    pause
    exit /b 1
)
echo [OK] data\        ^> %BACKUP_DIR%\data\

if exist "outputs" (
    xcopy /E /I /Y /Q "outputs" "%BACKUP_DIR%\outputs" >nul
    echo [OK] outputs\     ^> %BACKUP_DIR%\outputs\
)

echo.
echo =========================================================
echo   [OK] สำรองเรียบร้อย — %BACKUP_DIR%
echo =========================================================
echo.
echo เคล็ดลับ: ทำ backup สัปดาห์ละครั้งอย่างน้อย
echo            ทุกเดือนคัดลอกโฟลเดอร์ backup\ ไปไว้ใน USB หรือ Google Drive
echo.
pause

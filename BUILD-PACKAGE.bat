@echo off
chcp 65001 >nul
cd /d "%~dp0"
title HR-WWN - Build Distribution Package

echo.
echo =========================================================
echo   HR-WWN  -  Build Distribution Package
echo =========================================================
echo.
echo This script copies the project to a fresh folder, removes
echo node_modules / .secret / your live data, and resets all
echo data files to factory defaults so the package is safe to
echo hand to a new client.
echo.

REM Build timestamp YYYY-MM-DD
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value 2^>nul ^| find "="') do set DT=%%I
if "%DT%"=="" (
    REM Fallback: use PowerShell
    for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set DT=%%I
    set TIMESTAMP=%DT%
) else (
    set TIMESTAMP=%DT:~0,4%-%DT:~4,2%-%DT:~6,2%
)
set OUT=..\HR-WWN-Package_%TIMESTAMP%

echo Output folder:  %OUT%
echo.
set /p CONFIRM="Continue? (Y/N): "
if /i not "%CONFIRM%"=="Y" exit /b 0

echo.
echo Copying files...
if exist "%OUT%" rmdir /S /Q "%OUT%"
robocopy . "%OUT%" /E /XD node_modules .git backup /XF .secret BUILD-PACKAGE.bat /NFL /NDL /NJH /NJS /NC /NS /NP >nul

echo Resetting data folder to factory defaults...
node scripts\_reset-data.js "%OUT%"
if errorlevel 1 (
    echo.
    echo [X] data reset failed
    pause
    exit /b 1
)

echo.
echo =========================================================
echo   [OK] Done!
echo =========================================================
echo.
echo Distribution folder is ready at:
echo   %OUT%
echo.
echo Next steps:
echo   1. Right-click the folder ^> Send to ^> Compressed (zipped) folder
echo   2. Share the .zip with the client (USB, Email, Google Drive)
echo   3. Client unzips, opens "อ่านก่อน.txt", follows the steps
echo.
pause

@echo off
REM Start HR-Interview in production mode (Secure cookies + trust proxy enabled)
REM Usage: double-click this file or call from Task Scheduler

cd /d "%~dp0\.."
set SECURE_COOKIES=true
set PORT=3000
set NODE_ENV=production

echo Starting HR-Interview (production mode)
echo - Working dir: %CD%
echo - SECURE_COOKIES=true (cookie carries Secure attribute when behind HTTPS)
echo - PORT=3000
echo.

npm start

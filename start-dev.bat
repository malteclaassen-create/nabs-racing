@echo off
title NABS Racing - Starter
echo ==================================================
echo    NABS Racing - starting the development setup
echo ==================================================
echo.

echo [1/2] Starting the backend (http://localhost:4000) ...
start "NABS Backend" cmd /k "cd /d %~dp0backend && (if not exist node_modules npm install) && npm run dev"

echo       Giving the backend a moment to come up ...
timeout /t 3 /nobreak >nul

echo [2/2] Starting the frontend (http://localhost:5173) ...
start "NABS Frontend" cmd /k "cd /d %~dp0frontend && (if not exist node_modules npm install) && npm run dev -- --open"

echo.
echo Done! Two windows open:
echo    - "NABS Backend"  = server / API   (port 4000)
echo    - "NABS Frontend" = website        (port 5173)
echo.
echo The browser opens automatically at http://localhost:5173
echo.
echo To STOP everything, simply close those two windows.
echo You can close this window now.
echo.
pause

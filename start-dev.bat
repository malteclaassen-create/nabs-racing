@echo off
title NABS Racing - Starter
echo ==================================================
echo    NABS Racing - Entwicklungsumgebung wird gestartet
echo ==================================================
echo.

echo [1/2] Backend wird gestartet (http://localhost:4000) ...
start "NABS Backend" cmd /k "cd /d %~dp0backend && (if not exist node_modules npm install) && npm run dev"

echo       Kurz warten, bis das Backend laeuft ...
timeout /t 3 /nobreak >nul

echo [2/2] Frontend wird gestartet (http://localhost:5173) ...
start "NABS Frontend" cmd /k "cd /d %~dp0frontend && (if not exist node_modules npm install) && npm run dev -- --open"

echo.
echo Fertig! Es oeffnen sich zwei Fenster:
echo    - "NABS Backend"  = Server / API   (Port 4000)
echo    - "NABS Frontend" = Webseite       (Port 5173)
echo.
echo Der Browser oeffnet sich automatisch unter http://localhost:5173
echo.
echo Zum BEENDEN einfach die beiden Fenster schliessen.
echo Dieses Fenster kannst du jetzt schliessen.
echo.
pause

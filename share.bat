@echo off
title NABS Racing - Webseite teilen (Tunnel)
echo ==================================================
echo    NABS Racing - Webseite teilen (oeffentlicher Link)
echo ==================================================
echo.
echo HINWEIS: Falls "start-dev.bat" noch laeuft, schliesse zuerst
echo dessen "NABS Backend"-Fenster (sonst streiten sie sich um Port 4000).
echo.
pause

echo [1/4] Backend wird gestartet (Port 4000) ...
start "NABS Backend" cmd /k "cd /d %~dp0backend && (if not exist node_modules npm install) && npm run dev"
timeout /t 3 /nobreak >nul

echo [2/4] Webseite wird gebaut ...
cd /d %~dp0frontend
call npm run build
if errorlevel 1 ( echo. & echo Build fehlgeschlagen - bitte oben nachsehen. & pause & exit /b 1 )

echo [3/4] Vorschau-Server wird gestartet (Port 4173) ...
start "NABS Preview" cmd /k "cd /d %~dp0frontend && npm run preview"
timeout /t 3 /nobreak >nul

echo [4/4] Tunnel wird geoeffnet ...
echo.
echo    Gleich erscheint hier UNTEN ein Link wie:
echo        https://irgendwas.trycloudflare.com
echo    Diesen Link kopieren und dem Server-Admin schicken.
echo    Dieses Fenster MUSS offen bleiben, solange er draufschaut.
echo.
REM --protocol http2 = Tunnel ueber TCP statt UDP/QUIC: stabiler an
REM Heimanschluessen, weniger "Seite friert 10 Sekunden ein".
cloudflared tunnel --url http://localhost:4173 --protocol http2

echo.
echo Tunnel beendet. Zum Schliessen Taste druecken.
pause

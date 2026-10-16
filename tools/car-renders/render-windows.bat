@echo off
setlocal
rem ---------------------------------------------------------------------------
rem  Season Wrapped films of the league's car, rendered on this PC's graphics
rem  card (README.md). Double-click it; it asks for the car's folder, renders
rem  every livery in liveries\season-8.json and packs the result into
rem  tools\car-renders\nabs-wrapped-films.zip, to hand over.
rem
rem  Needs, once: Node.js (nodejs.org, LTS), Python 3 (python.org, "Add to
rem  PATH" ticked) and ffmpeg (in a terminal: winget install ffmpeg).
rem ---------------------------------------------------------------------------
cd /d "%~dp0..\.."

where node >nul 2>nul || (echo Node.js fehlt: https://nodejs.org installieren, dann neu starten. & pause & exit /b 1)
where python >nul 2>nul || (echo Python fehlt: https://python.org installieren, "Add python.exe to PATH" anhaken. & pause & exit /b 1)
where ffmpeg >nul 2>nul || (echo ffmpeg fehlt: im Terminal "winget install ffmpeg" ausfuehren, dann neu starten. & pause & exit /b 1)

echo Einmalige Vorbereitung (beim ersten Mal ein paar Minuten)...
python -m pip install --quiet --user pillow numpy || (echo Python-Pakete liessen sich nicht installieren. & pause & exit /b 1)
if not exist "frontend\node_modules\three" (
  pushd frontend & call npm install --no-audit --no-fund & popd
)
if not exist "frontend\node_modules\playwright" (
  pushd frontend & call npm install --no-save --no-audit --no-fund playwright & popd
)
pushd frontend & call npx playwright install chromium & popd

set "CAR=C:\Program Files (x86)\Steam\steamapps\common\assettocorsa\content\cars\formula_2010"
echo.
echo Ordner des Autos (Enter fuer: %CAR%)
set /p "CAR=> "
if not exist "%CAR%\skins" (echo In "%CAR%" gibt es keinen skins-Ordner. & pause & exit /b 1)

echo.
echo Rendere die Filme (ein Browserfenster geht auf, bitte offen lassen)...
node tools\car-renders\render.mjs "%CAR%" tools\car-renders\liveries\season-8.json tools\car-renders\out --gpu --jobs 2 || (echo Rendern abgebrochen. Nochmal starten macht da weiter, wo es war. & pause & exit /b 1)

python tools\car-renders\pack.py tools\car-renders\liveries\season-8.json tools\car-renders\out frontend\public\cars || (pause & exit /b 1)
powershell -NoProfile -Command "Compress-Archive -Force -Path 'frontend\public\cars' -DestinationPath 'tools\car-renders\nabs-wrapped-films.zip'"
echo.
echo Fertig: tools\car-renders\nabs-wrapped-films.zip
explorer /select,"%cd%\tools\car-renders\nabs-wrapped-films.zip"
pause

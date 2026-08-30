@echo off
rem Doppelklick: startet den Dev-Server (falls noetig) und oeffnet den Editor.
rem   start.cmd              -> http://localhost:5199/track-editor/
rem   start.cmd -Profiling   -> Profiling-Server auf 5299
rem   start.cmd -NoBrowser   -> nur starten, nichts oeffnen
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\open-editor.ps1" %*
if errorlevel 1 pause

@echo off
setlocal
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE=1"
if exist "%~dp0resources\app.asar" (
  "%~dp0minimal-downloader.exe" "%~dp0resources\app.asar\tools\add-game.cjs"
) else if exist "%~dp0node_modules\electron\dist\electron.exe" (
  "%~dp0node_modules\electron\dist\electron.exe" "%~dp0tools\add-game.cjs"
) else (
  node "%~dp0tools\add-game.cjs"
)
pause

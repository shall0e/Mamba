@echo off
setlocal
if exist "%~dp0resources\app.asar" (
  powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0MambaHelper.ps1" -RuntimeExe "%~dp0minimal-downloader.exe" -HelperScript "%~dp0resources\app.asar\tools\add-game.cjs"
) else if exist "%~dp0node_modules\electron\dist\electron.exe" (
  powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0helper\run.ps1" -RuntimeExe "%~dp0node_modules\electron\dist\electron.exe" -HelperScript "%~dp0tools\add-game.cjs"
) else (
  echo Open Mamba once, then run ADD-GAME.cmd inside the game folder.
)
pause

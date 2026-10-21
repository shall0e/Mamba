@echo off
setlocal
set "MAMBA_GAME_FOLDER=%~dp0."
if not exist "%LOCALAPPDATA%\Mamba\run-game-helper.ps1" (
  echo Open Mamba once on this computer, then run this command again.
  pause
  exit /b 1
)
cd /d "%TEMP%"
start "" powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\Mamba\run-game-helper.ps1" -GameFolder "%MAMBA_GAME_FOLDER%"
exit /b

@echo off
setlocal
set "MAMBA_ROOT=%~dp0"
if not exist "%MAMBA_ROOT%resources\app.asar" set "MAMBA_ROOT=%~dp0..\"
if exist "%MAMBA_ROOT%resources\app.asar" (
  powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%MAMBA_ROOT%MambaHelper.ps1" -RuntimeExe "%MAMBA_ROOT%Mamba.exe" -HelperScript "%MAMBA_ROOT%resources\app.asar\tools\add-game.cjs"
) else if exist "%MAMBA_ROOT%node_modules\electron\dist\electron.exe" (
  powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%MAMBA_ROOT%tools\helper\run.ps1" -RuntimeExe "%MAMBA_ROOT%node_modules\electron\dist\electron.exe" -HelperScript "%MAMBA_ROOT%tools\add-game.cjs"
) else (
  echo Open Mamba once, then run ADD-GAME.cmd inside the game folder.
)
pause

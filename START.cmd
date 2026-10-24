@echo off
rem Read the whole block before Git can update this launcher.
(
  where git >nul 2>&1
  if errorlevel 1 (
    echo Git is required to update Mamba. Install Git for Windows and try again.
    pause
    exit /b 1
  )
  echo Stopping running Mamba processes...
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\stop-running.ps1"
  if errorlevel 1 (
    echo Could not stop Mamba. Close it manually and run START.cmd again.
    pause
    exit /b 1
  )
  echo Updating Mamba from GitHub...
  git -C "%~dp0." pull --ff-only
  if errorlevel 1 (
    echo.
    echo Update failed. Mamba was not started. Your local changes have been kept.
    echo Resolve the Git error above, then run START.cmd again.
    pause
    exit /b 1
  )
  start "" wscript.exe "%~dp0tools\start.vbs"
  exit /b 0
)

@echo off
setlocal
if exist "%~dp0Mamba.exe" (
  set "ELECTRON_RUN_AS_NODE=1"
  "%~dp0Mamba.exe" "%~dp0resources\app.asar\tools\mamba-cli.cjs" %*
  exit /b
)
node "%~dp0mamba-cli.cjs" %*

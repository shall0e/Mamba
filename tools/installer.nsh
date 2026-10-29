!macro customInstall
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\cli-path.ps1" -InstallDirectory "$INSTDIR" -Mode Add'
  Pop $0
!macroend

!macro customUnInstall
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\cli-path.ps1" -InstallDirectory "$INSTDIR" -Mode Remove'
  Pop $0
!macroend

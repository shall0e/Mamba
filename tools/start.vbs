Option Explicit
Dim shell, files, root, electron
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(files.GetParentFolderName(WScript.ScriptFullName))
electron = files.BuildPath(root, "node_modules\electron\dist\electron.exe")
If Not files.FileExists(electron) Then
  MsgBox "Mamba needs its dependencies installed first. Run npm ci in the project folder.", 48, "Mamba"
  WScript.Quit 1
End If
shell.CurrentDirectory = root
shell.Environment("Process").Remove "ELECTRON_RUN_AS_NODE"
shell.Run Chr(34) & electron & Chr(34) & " .", 1, False

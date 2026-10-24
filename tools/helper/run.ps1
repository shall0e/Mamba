param([string]$GameFolder, [string]$RuntimeExe, [string]$HelperScript)
$ErrorActionPreference = 'Stop'
try {
  $Host.UI.RawUI.WindowTitle = 'Mamba - Game setup'
  Clear-Host
  if (!$RuntimeExe -or !$HelperScript) {
    $runtimePath = Join-Path $PSScriptRoot 'helper-runtime.json'
    $runtime = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json
    $RuntimeExe = $runtime.executable
    $HelperScript = $runtime.script
  }
  if (!(Test-Path -LiteralPath $RuntimeExe -PathType Leaf)) {
    throw 'Open Mamba from its current location on this computer, then run ADD-GAME.cmd again.'
  }
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $RuntimeExe
  $info.Arguments = '"' + $HelperScript.Replace('"', '') + '"'
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardInput = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.WorkingDirectory = [IO.Path]::GetTempPath()
  $info.EnvironmentVariables['ELECTRON_RUN_AS_NODE'] = '1'
  $info.EnvironmentVariables['MAMBA_HELPER_BRIDGE'] = '1'
  if ($GameFolder) { $info.EnvironmentVariables['MAMBA_GAME_FOLDER'] = [IO.Path]::GetFullPath($GameFolder) }
  $child = New-Object System.Diagnostics.Process
  $child.StartInfo = $info
  [void]$child.Start()
  $errors = $child.StandardError.ReadToEndAsync()
  while ($null -ne ($line = $child.StandardOutput.ReadLine())) {
    if ($line.StartsWith('__MAMBA_PROMPT__')) {
      $prompt = $line.Substring(16) | ConvertFrom-Json
      $answer = Read-Host $prompt.TrimEnd(' ', ':')
      $child.StandardInput.WriteLine($answer)
      $child.StandardInput.Flush()
    } else { Write-Host $line }
  }
  $child.WaitForExit()
  $errorText = $errors.GetAwaiter().GetResult()
  if ($errorText) { Write-Host $errorText -ForegroundColor Red }
  if ($child.ExitCode -ne 0) { throw ('Game helper exited with code ' + $child.ExitCode) }
} catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }

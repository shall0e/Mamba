param([Parameter(Mandatory=$true)][string]$GameFolder)
$ErrorActionPreference = 'Stop'
try {
  $runtimePath = Join-Path $PSScriptRoot 'helper-runtime.json'
  $runtime = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json
  if (!(Test-Path -LiteralPath $runtime.executable -PathType Leaf)) {
    throw 'Open Mamba from its current location on this computer, then run ADD-GAME.cmd again.'
  }
  $env:ELECTRON_RUN_AS_NODE = '1'
  $env:MAMBA_GAME_FOLDER = [IO.Path]::GetFullPath($GameFolder)
  & $runtime.executable $runtime.script
} catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }

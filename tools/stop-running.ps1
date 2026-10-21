$ErrorActionPreference = 'Stop'
try {
    $root = Split-Path $PSScriptRoot -Parent
    $executable = [System.IO.Path]::GetFullPath((Join-Path $root 'node_modules\electron\dist\electron.exe'))
    $running = @(Get-Process -Name electron -ErrorAction SilentlyContinue | Where-Object {
        $_.Path -and [string]::Equals($_.Path, $executable, [System.StringComparison]::OrdinalIgnoreCase)
    })
    foreach ($instance in $running) {
        if ($instance.HasExited) { continue }
        Stop-Process -InputObject $instance -Force -ErrorAction Stop
        if (!$instance.WaitForExit(10000)) { throw 'Mamba did not stop within 10 seconds.' }
    }
    exit 0
} catch {
    Write-Error $_
    exit 1
}

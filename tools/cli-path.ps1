param(
  [Parameter(Mandatory = $true)][string]$InstallDirectory,
  [ValidateSet('Add', 'Remove')][string]$Mode = 'Add',
  [switch]$Preview
)
$targetDirectory = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\')
if ($targetDirectory.Contains(';')) { throw 'The CLI installation path cannot contain a semicolon.' }
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$entries = @($userPath -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ine $targetDirectory })
if ($Mode -eq 'Add') { $entries = @($targetDirectory) + $entries }
$updatedPath = $entries -join ';'
if ($Preview) { $updatedPath; exit 0 }
if ($updatedPath -ne $userPath) { [Environment]::SetEnvironmentVariable('Path', $updatedPath, 'User') }

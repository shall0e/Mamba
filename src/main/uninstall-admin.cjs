const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const execute = promisify(require('node:child_process').execFile);
async function uninstallAsAdministrator(folder, { run = execute } = {}) {
  if (!path.isAbsolute(folder)) throw Error('Invalid installation path.');
  const target = path.resolve(folder);
  if (
    target === path.parse(target).root ||
    (await fs.lstat(target)).isSymbolicLink() ||
    (await fs.realpath(target)).toLowerCase() !== target.toLowerCase()
  )
    throw Error('The installation path changed. Reopen game details before uninstalling.');
  if (await require('../core/uninstall.cjs').xboxManaged(target))
    throw Error('Uninstall this installation through Xbox or Windows Installed apps.');
  const powershell = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const payload = Buffer.from(target).toString('base64');
  const operation = `
$ErrorActionPreference='Stop'
try {
 $target=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))
 $item=Get-Item -LiteralPath $target -Force
 if(!$item.PSIsContainer -or $item.FullName -ne $target -or $item.FullName -eq [IO.Path]::GetPathRoot($target)){exit 3}
 $cursor=$item
 while($cursor){if($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint){exit 3};$cursor=$cursor.Parent}
 if((Test-Path -LiteralPath (Join-Path $target 'MicrosoftGame.config')) -or (Test-Path -LiteralPath (Join-Path $target 'Content\\MicrosoftGame.config'))){exit 3}
 $links=Get-ChildItem -LiteralPath $target -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint } | Select-Object -First 1
 if($links){exit 3}
 Remove-Item -LiteralPath $target -Recurse -Force
 if(Test-Path -LiteralPath $target){exit 1}
 exit 0
} catch {exit 1}
`;
  const encoded = Buffer.from(operation, 'utf16le').toString('base64');
  const executable = Buffer.from(powershell).toString('base64');
  const request = `$exe=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${executable}'));try{$p=Start-Process -FilePath $exe -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoLogo -NoProfile -NonInteractive -EncodedCommand ${encoded}' -Wait -PassThru;[Console]::WriteLine($p.ExitCode)}catch{if($_.Exception.NativeErrorCode -eq 1223 -or $_.Exception.InnerException.NativeErrorCode -eq 1223){[Console]::WriteLine(1223)}else{[Console]::WriteLine(1)}}`;
  const { stdout } = await run(
    powershell,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(request, 'utf16le').toString('base64'),
    ],
    { windowsHide: true, maxBuffer: 4096 },
  );
  const code = Number(stdout.trim());
  if (code === 1223) return false;
  if (code !== 0)
    throw Error(
      'Windows could not uninstall this game with administrator access. Close its launcher or uninstall through the app that installed it.',
    );
  if (
    await fs.lstat(target).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    })
  )
    throw Error('Some installation files remain. Uninstall did not finish.');
  return true;
}
module.exports = { uninstallAsAdministrator };

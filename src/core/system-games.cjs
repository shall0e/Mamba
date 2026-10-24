const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);

function steamLibraries(text) {
  return [...String(text).matchAll(/"path"\s*"([^"\r\n]+)"/gi)].map((match) =>
    match[1].replace(/\\\\/g, '\\'),
  );
}
async function registeredLocations() {
  if (process.platform !== 'win32') return { steam: [], games: [] };
  const script = `
$ErrorActionPreference='SilentlyContinue'
$steam=@((Get-ItemProperty 'HKCU:\\Software\\Valve\\Steam').SteamPath,(Get-ItemProperty 'HKLM:\\SOFTWARE\\WOW6432Node\\Valve\\Steam').InstallPath) | Where-Object { $_ }
$games=@()
foreach($key in @('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')) {
  Get-ItemProperty $key | Where-Object { $_.InstallLocation -and ($_.PSChildName -match '^Steam App \\d+$' -or $_.Publisher -match 'GOG|Ubisoft|Electronic Arts|Rockstar|Bethesda|2K|CD PROJEKT|Larian|Paradox') } | ForEach-Object { $games += $_.InstallLocation }
}
Get-ItemProperty 'HKLM:\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\*' | ForEach-Object { if($_.path){$games += $_.path} }
Get-AppxPackage | ForEach-Object { if($_.InstallLocation -and (Test-Path -LiteralPath (Join-Path $_.InstallLocation 'MicrosoftGame.config'))) { $games += $_.InstallLocation } }
@{steam=@($steam);games=@($games)} | ConvertTo-Json -Compress
`;
  try {
    const { stdout } = await execute(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, timeout: 12000, maxBuffer: 1024 * 1024 },
    );
    return JSON.parse(stdout.trim());
  } catch {
    return { steam: [], games: [] };
  }
}
let cached;
async function discoverSystemGames({ force = false } = {}) {
  if (!force && cached && Date.now() - cached.at < 60000) return cached.value;
  const registered = await registeredLocations();
  const roots = await require('./library-folders.cjs').defaultFolders();
  for (const steam of registered.steam || []) {
    roots.push(path.join(steam, 'steamapps', 'common'));
    const vdf = await fs
      .readFile(path.join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8')
      .catch(() => '');
    roots.push(...steamLibraries(vdf).map((folder) => path.join(folder, 'steamapps', 'common')));
  }
  const games = [...(registered.games || [])];
  if (process.env.PROGRAMDATA) {
    const directory = path.join(
      process.env.PROGRAMDATA,
      'Epic',
      'EpicGamesLauncher',
      'Data',
      'Manifests',
    );
    for (const file of await fs.readdir(directory).catch(() => [])) {
      if (!file.endsWith('.item')) continue;
      try {
        const manifest = JSON.parse(await fs.readFile(path.join(directory, file), 'utf8'));
        if (manifest.InstallLocation && manifest.LaunchExecutable)
          games.push(manifest.InstallLocation);
      } catch {}
    }
  }
  const valid = (values) => [
    ...new Map(
      values
        .filter(
          (folder) =>
            typeof folder === 'string' &&
            path.isAbsolute(folder) &&
            path.resolve(folder) !== path.parse(folder).root,
        )
        .map((folder) => [path.resolve(folder).toLowerCase(), path.resolve(folder)]),
    ).values(),
  ];
  const value = { roots: valid(roots), games: valid(games) };
  cached = { at: Date.now(), value };
  return value;
}
module.exports = { discoverSystemGames, steamLibraries };

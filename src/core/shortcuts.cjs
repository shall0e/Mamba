const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const quote = (value) => '"' + String(value).replace(/"/g, '') + '"';
function launchTarget(file, argumentsText = '') {
  const extra = require('./launch-options.cjs').normalizeLaunchOptions({
    arguments: argumentsText,
  }).arguments;
  const suffix = extra ? ' ' + extra : '';
  const ext = path.extname(file).toLowerCase();
  if (['.bat', '.cmd'].includes(ext))
    return {
      exe: quote(process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe'),
      args: '/d /s /c "' + quote(file) + suffix + '"',
    };
  if (ext === '.ps1')
    return {
      exe: quote(
        path.join(
          process.env.SystemRoot || 'C:\\Windows',
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe',
        ),
      ),
      args: '-NoProfile -File ' + quote(file) + suffix,
    };
  if (ext === '.lnk')
    return {
      exe: quote(path.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe')),
      args: quote(file) + suffix,
    };
  if (ext !== '.exe' && ext !== '.com')
    throw new Error('Choose an EXE, COM, BAT, CMD, PS1 or shortcut file.');
  return { exe: quote(file), args: extra };
}
async function desktopShortcut(name, file, folder, desktopDirectory) {
  const target = launchTarget(file);
  const payload = Buffer.from(
    JSON.stringify({ name, file, folder, desktopDirectory, ...target }),
  ).toString('base64');
  const script = `$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json; $w=New-Object -ComObject WScript.Shell; $desktop=if($p.desktopDirectory){$p.desktopDirectory}else{[Environment]::GetFolderPath('Desktop')}; $link=Join-Path $desktop ($p.name+'.lnk'); $i=1; while(Test-Path -LiteralPath $link){ $old=$w.CreateShortcut($link); if($old.TargetPath -eq $p.exe.Trim([char]34) -and $old.Arguments -eq $p.args){break}; $link=Join-Path $desktop ($p.name+' (Mamba '+$i+').lnk'); $i++ }; $s=$w.CreateShortcut($link); $s.TargetPath=$p.exe.Trim([char]34); $s.Arguments=$p.args; $s.WorkingDirectory=$p.folder; $s.Save()`;
  await exec(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    { windowsHide: true },
  );
}

function parseVdf(buffer) {
  let pos = 0;
  function string() {
    const end = buffer.indexOf(0, pos);
    if (end < 0) throw Error('Invalid Steam shortcut file.');
    const value = buffer.toString('utf8', pos, end);
    pos = end + 1;
    return value;
  }
  function entries(depth = 0) {
    if (depth > 40) throw Error('Steam shortcut nesting is invalid.');
    const nodes = [];
    while (pos < buffer.length) {
      const start = pos,
        type = buffer[pos++];
      if (type === 8) return nodes;
      const key = string();
      let value;
      if (type === 0) value = entries(depth + 1);
      else if (type === 1) value = string();
      else {
        const size = { 2: 4, 3: 4, 4: 4, 6: 4, 7: 8, 10: 8 }[type];
        if (!size || pos + size > buffer.length)
          throw Error('Unsupported Steam shortcut format; original preserved.');
        value = buffer.subarray(pos, pos + size);
        pos += size;
      }
      nodes.push({ key, type, value, raw: buffer.subarray(start, pos) });
    }
    throw Error('Incomplete Steam shortcut file.');
  }
  const root = entries();
  if (pos !== buffer.length) throw Error('Unexpected Steam shortcut data.');
  return root;
}
const field = (key, value) =>
  Buffer.concat([
    Buffer.from([typeof value === 'number' ? 2 : 1]),
    Buffer.from(key + '\0'),
    typeof value === 'number'
      ? (() => {
          const b = Buffer.alloc(4);
          b.writeUInt32LE(value >>> 0);
          return b;
        })()
      : Buffer.from(value + '\0'),
  ]);
const object = (key, children) =>
  Buffer.concat([Buffer.from([0]), Buffer.from(key + '\0'), ...children, Buffer.from([8])]);
function crc32(text) {
  let crc = 0xffffffff;
  for (const byte of Buffer.from(text)) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function addShortcut(buffer, game) {
  const roots = buffer.length ? parseVdf(buffer) : [{ key: 'shortcuts', type: 0, value: [] }];
  const root = roots.find((node) => node.key === 'shortcuts' && node.type === 0);
  if (!root) throw Error('Missing Steam shortcuts object.');
  const options = require('./launch-options.cjs').launchConfiguration(game);
  const launch = launchTarget(game.executable, options.arguments);
  const entry = root.value.find(
    (node) =>
      node.type === 0 &&
      node.value.some(
        (f) =>
          (f.key.toLowerCase() === 'exe' &&
            String(f.value).toLowerCase() === launch.exe.toLowerCase()) ||
          (f.key.toLowerCase() === 'appname' &&
            String(f.value).toLowerCase() === game.name.toLowerCase()),
      ),
  );
  const values = {
    appid: (crc32(launch.exe + game.name) | 0x80000000) >>> 0,
    appname: game.name,
    exe: launch.exe,
    StartDir: quote(options.cwd),
    LaunchOptions: launch.args,
  };
  if (
    entry &&
    Object.entries(values).every(([key, value]) =>
      entry.value.some(
        (field) =>
          field.key.toLowerCase() === key.toLowerCase() &&
          (typeof value === 'number'
            ? Buffer.isBuffer(field.value) && field.value.readUInt32LE(0) === value
            : String(field.value) === value),
      ),
    )
  )
    return Buffer.from(buffer);
  let shortcut;
  if (entry) {
    const remaining = new Map(Object.entries(values).map(([k, v]) => [k.toLowerCase(), [k, v]]));
    const fields = entry.value.map((f) => {
      const replacement = remaining.get(f.key.toLowerCase());
      if (!replacement) return f.raw;
      remaining.delete(f.key.toLowerCase());
      return field(...replacement);
    });
    for (const value of remaining.values()) fields.push(field(...value));
    shortcut = object(entry.key, fields);
  } else {
    const index =
      Math.max(-1, ...root.value.map((n) => (/^\d+$/.test(n.key) ? Number(n.key) : -1))) + 1;
    shortcut = object(String(index), [
      ...Object.entries({
        ...values,
        icon: '',
        ShortcutPath: '',
        IsHidden: 0,
        AllowDesktopConfig: 1,
        AllowOverlay: 1,
        OpenVR: 0,
        Devkit: 0,
        DevkitGameID: '',
        DevkitOverrideAppID: 0,
        LastPlayTime: 0,
        FlatpakAppID: '',
      }).map(([k, v]) => field(k, v)),
      object('tags', [field('0', 'Mamba')]),
    ]);
  }
  const children = root.value.map((node) => (node === entry ? shortcut : node.raw));
  if (!entry) children.push(shortcut);
  return Buffer.concat([
    ...roots.map((node) => (node === root ? object('shortcuts', children) : node.raw)),
    Buffer.from([8]),
  ]);
}
async function steamRunning() {
  const { stdout } = await exec(
    'tasklist.exe',
    ['/FI', 'IMAGENAME eq steam.exe', '/FO', 'CSV', '/NH'],
    { windowsHide: true },
  );
  return /"steam\.exe"/i.test(stdout);
}
async function steamProfile() {
  const { stdout } = await exec(
    'reg.exe',
    ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
    { windowsHide: true },
  ).catch(() => {
    throw Error('Steam installation was not found.');
  });
  const root = stdout.match(/SteamPath\s+REG_SZ\s+([^\r\n]+)/i)?.[1].trim();
  if (!root) throw Error('Steam installation was not found.');
  try {
    await fs.access(path.join(root, 'steam.exe'));
  } catch {
    throw Error('Steam installation was not found.');
  }
  let user;
  try {
    const active = await exec(
      'reg.exe',
      ['query', 'HKCU\\Software\\Valve\\Steam\\ActiveProcess', '/v', 'ActiveUser'],
      { windowsHide: true },
    );
    const raw = active.stdout.match(/ActiveUser\s+REG_DWORD\s+(\S+)/i)?.[1];
    if (raw && Number(raw) > 0) user = String(Number(raw));
  } catch {}
  if (!user) {
    const logins = await fs
      .readFile(path.join(root, 'config', 'loginusers.vdf'), 'utf8')
      .catch(() => '');
    const recent = [...logins.matchAll(/"(\d{17})"\s*\{([^{}]*)\}/g)].find((match) =>
      /"MostRecent"\s+"1"/i.test(match[2]),
    );
    if (recent) user = String(BigInt(recent[1]) - 76561197960265728n);
  }
  if (!user) throw Error('Sign into Steam once so Mamba can identify your library.');
  return path.join(root, 'userdata', user, 'config', 'shortcuts.vdf');
}
async function launchSteam(file, args) {
  const executable = path.join(path.resolve(path.dirname(file), '..', '..', '..'), 'steam.exe');
  await new Promise((resolve, reject) => {
    const child = require('node:child_process').spawn(executable, args, {
      windowsHide: true,
      detached: true,
      stdio: 'ignore',
      cwd: path.dirname(executable),
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
let queue = Promise.resolve();
function registerSteam(
  game,
  {
    profile = steamProfile,
    running = steamRunning,
    shutdown = (file) => launchSteam(file, ['-shutdown']),
    reopen = (file) => launchSteam(file, ['-silent']),
    pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
  } = {},
) {
  const task = queue
    .catch(() => {})
    .then(async () => {
      const file = await profile();
      let restart = false;
      const read = () =>
        fs.readFile(file).catch((error) => {
          if (error.code === 'ENOENT') return Buffer.alloc(0);
          throw error;
        });

      const existing = await read();
      if (addShortcut(existing, game).equals(existing))
        return { status: 'added', message: 'Already in Steam.' };
      try {
        if (await running()) {
          await shutdown(file);
          const deadline = now() + 45000;
          while (await running()) {
            if (now() >= deadline)
              return {
                status: 'pending',
                message:
                  'Steam did not finish closing. Finish its exit prompt, then retry adding the game.',
              };
            await pause(500);
          }
          restart = true;
        }
        await fs.mkdir(path.dirname(file), { recursive: true });
        const lock = await fs.open(file + '.mamba-lock', 'wx');
        try {
          const before = await read();
          const after = addShortcut(before, game);
          if (after.equals(before)) return { status: 'added', message: 'Already in Steam.' };
          if (await running())
            return {
              status: 'pending',
              message: 'Steam reopened before registration finished. Retry adding the game.',
            };
          if (before.length)
            await fs.copyFile(
              file,
              file + '.mamba-backup-' + Date.now(),
              require('node:fs').constants.COPYFILE_EXCL,
            );
          if (!(await read()).equals(before))
            throw Error('Steam shortcuts changed during registration. Retry adding the game.');
          await fs.writeFile(file + '.mamba-tmp', after);
          await fs.rename(file + '.mamba-tmp', file);
          return {
            status: 'added',
            message: restart
              ? 'Added to Steam. Steam is reopening automatically.'
              : 'Added to Steam.',
          };
        } finally {
          await lock.close();
          await fs.unlink(file + '.mamba-lock').catch(() => {});
        }
      } finally {
        if (restart)
          await reopen(file).catch((error) => {
            throw Error('Shortcut saved, but Steam could not reopen: ' + error.message);
          });
      }
    });
  queue = task;
  return task;
}
async function steamLaunchUrl(game, { profile = steamProfile, setup } = {}) {
  const steamId = Number(game.steamId);
  if (game.steamLibrary && Number.isSafeInteger(steamId) && steamId > 0)
    return 'steam://run/' + steamId;
  let file;
  try {
    file = await profile();
  } catch (error) {
    if (
      error.message === 'Steam installation was not found.' ||
      error.message === 'Sign into Steam once so Mamba can identify your library.'
    )
      return null;
    throw error;
  }
  const read = () =>
    fs.readFile(file).catch((error) => {
      if (error.code === 'ENOENT') return Buffer.alloc(0);
      throw error;
    });
  let buffer = await read();
  let registered = game;
  if (!addShortcut(buffer, game).equals(buffer)) {
    const result = await setup(game);
    if (result.steam?.status !== 'added')
      throw Error(result.steam?.message || 'Could not add this game to Steam.');
    registered = { ...game, ...result };
    buffer = await read();
  }
  const launch = launchTarget(registered.executable);
  const root = parseVdf(buffer).find((node) => node.key === 'shortcuts');
  const entry = root?.value.find(
    (node) =>
      node.type === 0 &&
      node.value.some(
        (field) =>
          field.key.toLowerCase() === 'exe' &&
          String(field.value).toLowerCase() === launch.exe.toLowerCase(),
      ) &&
      node.value.some(
        (field) =>
          field.key.toLowerCase() === 'appname' &&
          String(field.value).toLowerCase() === registered.name.toLowerCase(),
      ),
  );
  const appid = entry?.value.find((field) => field.key.toLowerCase() === 'appid')?.value;
  if (!Buffer.isBuffer(appid) || appid.length !== 4)
    throw Error('Steam shortcut could not be located after registration.');
  const gameId = (BigInt(appid.readUInt32LE(0)) << 32n) | 0x02000000n;
  return 'steam://rungameid/' + gameId;
}
module.exports = {
  steamProfile,
  launchTarget,
  desktopShortcut,
  parseVdf,
  addShortcut,
  registerSteam,
  steamLaunchUrl,
};

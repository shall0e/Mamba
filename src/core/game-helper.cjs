const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const sourceRoot = path.resolve(__dirname, '../..');
async function registerHelperRuntime(
  directory = path.join(process.env.LOCALAPPDATA, 'Mamba'),
  executable = process.execPath,
) {
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'helper-runtime.json');
  const temporary = file + '.' + randomUUID() + '.tmp';
  await fs.writeFile(
    temporary,
    JSON.stringify({ executable, script: path.join(sourceRoot, 'tools', 'add-game.cjs') }),
  );
  await fs.rename(temporary, file);
  await fs.writeFile(
    path.join(directory, 'run-game-helper.ps1'),
    await fs.readFile(path.join(sourceRoot, 'tools', 'helper', 'run.ps1')),
  );
}
async function installGameHelper(folder) {
  const root = path.resolve(folder);
  const stat = await fs.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Invalid game helper destination.');
  const command = path.join(root, 'ADD-GAME.cmd');
  const existing = await fs.lstat(command).catch(() => null);
  if (existing?.isSymbolicLink()) throw Error('The helper command cannot be a symbolic link.');
  const old = await fs.readFile(command, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (old && !old.includes('MAMBA_GAME_FOLDER') && !old.includes('run-game-helper.ps1'))
    throw Error('An unrelated ADD-GAME.cmd already exists.');
  const contents = await fs.readFile(path.join(sourceRoot, 'tools', 'helper', 'ADD-GAME.cmd'));
  if (old !== contents.toString()) await fs.writeFile(command, contents);
  return command;
}
async function openGameHelper(
  folder,
  launch = require('node:util').promisify(require('node:child_process').execFile),
) {
  const script = path.join(process.env.LOCALAPPDATA, 'Mamba', 'run-game-helper.ps1');
  await fs.access(script);
  const payload = Buffer.from(
    JSON.stringify({ script, folder: path.resolve(folder), cwd: require('node:os').tmpdir() }),
  ).toString('base64');
  const command =
    "$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" +
    payload +
    "'))|ConvertFrom-Json; $arguments='-NoProfile -NoExit -ExecutionPolicy Bypass -File '+[char]34+$p.script+[char]34+' -GameFolder '+[char]34+$p.folder+[char]34; Start-Process -FilePath powershell.exe -ArgumentList $arguments -WorkingDirectory $p.cwd -WindowStyle Normal";
  await launch(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(command, 'utf16le').toString('base64'),
    ],
    { windowsHide: true },
  );
}
module.exports = { installGameHelper, registerHelperRuntime, openGameHelper };

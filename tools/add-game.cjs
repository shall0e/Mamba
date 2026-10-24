const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline/promises');
const {
  finalizeInstallation,
  detect,
  within,
  safeName,
  atomicJson,
} = require('../src/core/library.cjs');
const { desktopShortcut, registerSteam, launchTarget } = require('../src/core/shortcuts.cjs');
const { registerXbox } = require('../src/core/xbox.cjs');
const { Metadata } = require('../src/core/metadata.cjs');
const { displayTitle } = require('../src/core/search.cjs');
async function suggestedSettings(folder) {
  const root = path.resolve(folder);
  const manifest = JSON.parse(
    await fs.readFile(path.join(root, '.mamba-game.json'), 'utf8').catch(() => '{}'),
  );
  const saved = JSON.parse(
    await fs.readFile(path.join(root, '.mamba-helper.json'), 'utf8').catch(() => '{}'),
  );
  const candidates = [
    saved.launcher && path.resolve(root, saved.launcher),
    manifest.executable && path.resolve(root, manifest.executable),
  ];
  for (const file of candidates.filter(Boolean)) {
    try {
      within(root, file);
      launchTarget(file);
      if ((await fs.lstat(file)).isFile())
        return { folder: root, file, name: saved.name || manifest.name || path.basename(root) };
    } catch {}
  }
  return {
    folder: root,
    file: (await detect(root)).executable,
    name: manifest.name || path.basename(root),
  };
}
async function browse(kind, initial) {
  const payload = Buffer.from(JSON.stringify({ kind, initial })).toString('base64');
  const script = `$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json; Add-Type -AssemblyName System.Windows.Forms; if($p.kind -eq 'folder'){ $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.SelectedPath=$p.initial; if($d.ShowDialog() -eq 'OK'){$d.SelectedPath} }else{ $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Title='Choose the file that starts your game'; $d.InitialDirectory=$p.initial; $d.Filter='Game launchers|*.exe;*.com;*.bat;*.cmd;*.ps1;*.lnk|All files|*.*'; if($d.ShowDialog() -eq 'OK'){$d.FileName} }`;
  const { stdout } = await require('node:util').promisify(require('node:child_process').execFile)(
    'powershell.exe',
    ['-NoProfile', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true },
  );
  return stdout.trim();
}
async function addGame({
  file,
  folder,
  name,
  resolveName = async (value) => value,
  launchOptions,
  desktop = desktopShortcut,
  steam = registerSteam,
  xbox = registerXbox,
}) {
  within(folder, file);
  launchTarget(file);
  if (!(await fs.lstat(file)).isFile()) throw Error('Choose a launcher file.');
  const title = await resolveName(displayTitle(name));
  const result = await finalizeInstallation(folder, title, {
    executable: file,
    status: 'installed',
  });
  const game = {
    name: title,
    executable: result.executable,
    folder: result.folder,
    launchOptions: launchOptions || result.manifest.launchOptions || {},
  };
  const xboxRegistration = await xbox(game).catch((error) => ({
    status: 'pending',
    message: error.message,
  }));
  const registration = await steam(game).catch((error) => ({
    status: 'pending',
    message: error.message,
  }));
  await atomicJson(path.join(result.folder, '.mamba-game.json'), {
    ...result.manifest,
    executable: path.relative(result.folder, game.executable),
    launcherSelected: true,
    steam: registration,
    xbox: xboxRegistration,
  });
  await atomicJson(path.join(result.folder, '.mamba-helper.json'), {
    name: title,
    launcher: path.relative(result.folder, game.executable),
  });
  await desktop(safeName(title), game.executable, path.dirname(game.executable));
  return { ...game, steam: registration, xbox: xboxRegistration };
}
async function main() {
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (prompt) => {
    const bridge = process.env.MAMBA_HELPER_BRIDGE === '1';
    if (bridge) console.log('__MAMBA_PROMPT__' + JSON.stringify(prompt));
    return (await input.question(bridge ? '' : prompt)).trim().replace(/^"|"$/g, '');
  };
  try {
    console.log('\nMamba  /  Game setup');
    console.log('Choose how your game starts, then add shortcuts to your apps.\n');
    console.log('Step 1 of 4  /  Find your game');
    const defaultFolder = process.env.MAMBA_GAME_FOLDER || '';
    if (defaultFolder) console.log('Current folder: ' + defaultFolder);
    console.log(
      defaultFolder
        ? 'Press Enter to use this folder, B to browse for a launcher, or paste a path.\n'
        : 'Press B to browse for a launcher, or paste a game folder or launcher path.\n',
    );
    let supplied, stat;
    while (true) {
      const answer = await ask('Game location: ');
      const selection = /^b$/i.test(answer)
        ? await browse('file', defaultFolder || require('node:os').homedir())
        : answer || defaultFolder;
      try {
        if (!selection) throw Error('Select a game folder or startup file.');
        supplied = path.resolve(selection);
        stat = await fs.lstat(supplied);
        break;
      } catch (error) {
        console.log(
          'That location is unavailable. Choose a different folder or press B to browse.',
        );
      }
    }
    let file = supplied,
      suggestedFolder = stat.isDirectory() ? supplied : path.dirname(supplied);
    const defaults = stat.isDirectory() ? await suggestedSettings(supplied) : null;
    console.log('\nStep 2 of 4  /  Choose a launcher');
    if (stat.isDirectory()) {
      const found = await detect(supplied);
      console.log(
        found.executables.length
          ? '\nAvailable launchers:'
          : '\nNo launchers detected. Press B to browse.',
      );
      found.executables.forEach((item, index) =>
        console.log(`  ${index + 1}. ${path.relative(supplied, item)}`),
      );
      console.log(
        `\nSuggested: ${defaults.file ? path.relative(supplied, defaults.file) : 'None detected'}`,
      );
      console.log('Press Enter to accept, B to browse, or enter a number or path.\n');
      while (true) {
        const choice = await ask('Launcher: ');
        file = !choice
          ? defaults.file
          : /^b$/i.test(choice)
            ? await browse('file', supplied)
            : /^\d+$/.test(choice)
              ? found.executables[Number(choice) - 1]
              : path.resolve(supplied, choice);
        try {
          if (!file) throw Error('Choose a startup file.');
          launchTarget(file);
          if (!(await fs.lstat(file)).isFile()) throw Error('Choose a file, not a folder.');
          break;
        } catch (error) {
          console.log(error.message);
        }
      }
    }
    let manifest = {};
    for (let cursor = path.dirname(file); ; cursor = path.dirname(cursor)) {
      try {
        manifest = JSON.parse(await fs.readFile(path.join(cursor, '.mamba-game.json'), 'utf8'));
        suggestedFolder = cursor;
        break;
      } catch {}
      if (path.dirname(cursor) === cursor) break;
    }

    try {
      within(suggestedFolder, file);
    } catch {
      suggestedFolder = path.dirname(file);
    }
    console.log('\nStep 3 of 4  /  Confirm game details');
    console.log('Game folder: ' + suggestedFolder);
    console.log('Press Enter to keep it, B to browse, or paste a different folder.\n');
    let folder;
    while (true) {
      const choice = await ask('Game folder: ');
      folder = path.resolve(
        (/^b$/i.test(choice) ? await browse('folder', suggestedFolder) : choice) || suggestedFolder,
      );
      try {
        within(folder, file);
        if (!(await fs.lstat(folder)).isDirectory()) throw Error('Choose a folder.');
        break;
      } catch (error) {
        console.log('The root must contain the selected startup file. ' + error.message);
      }
    }
    console.log('\nSuggested name: ' + (manifest.name || path.basename(folder)));
    const name =
      (await ask('Game name (Enter to keep): ')) || manifest.name || path.basename(folder);
    console.log('\nStep 4 of 4  /  Review and add');
    console.log(
      `\nGame:     ${name}\nFolder:   ${folder}\nLauncher: ${path.relative(folder, file)}`,
    );
    console.log('\nMamba will tidy wrapper folders, name the game folder, and save this launcher.');
    console.log('A desktop shortcut will be created, with Steam and Xbox PC entries.\n');
    if (/^(n|no)$/i.test(await ask('Add game? [Y/n]: '))) {
      console.log('\nCancelled. No changes were made.');
      return;
    }
    console.log('\nAdding game. Please wait...');
    const project = path.resolve(__dirname, '..', 'data');
    const localProject = path.resolve(path.dirname(process.execPath), '..', '..', 'data');
    const hasConfig = async (directory) =>
      fs.access(path.join(directory, 'config.json')).then(
        () => true,
        () => false,
      );
    const directory =
      process.env.MAMBA_DATA_DIR ||
      ((await hasConfig(project))
        ? project
        : (await hasConfig(localProject))
          ? localProject
          : path.join(process.env.APPDATA, 'minimal-downloader'));
    const metadata = new Metadata(directory, { games: [], replace() {} });
    await metadata.load();
    const result = await addGame({
      file,
      folder,
      name,
      resolveName: (value) => metadata.resolveName(value),
    });
    console.log(
      `\nGame setup complete\n\nFolder: ${result.folder}\nDesktop shortcut created.\nSteam: ${result.steam.message}\nXbox PC: ${result.xbox.message}`,
    );
    console.log('The selected launcher will appear in Mamba automatically.');
  } finally {
    input.close();
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error('\n' + error.message);
    process.exitCode = 1;
  });
module.exports = { addGame, suggestedSettings };

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { within } = require('../core/library.cjs');
async function runSetupAsAdministrator(game, { automatic = false, wait = false } = {}) {
  if (process.platform !== 'win32')
    throw Error('Administrator setup is only available on Windows.');

  if (!game.installer) throw Error('No setup file was detected. Refresh the library.');
  const folder = await fs.realpath(game.folder),
    target = await fs.realpath(game.installer);
  within(folder, target);
  if (!/\.(exe|msi)$/i.test(target) || !(await fs.lstat(target)).isFile())
    throw Error('The setup file is no longer available.');
  const quote = (value) => "'" + value.replace(/'/g, "''") + "'";
  const commandLineArgument = (value) =>
    '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"';
  const plan = automatic
    ? await require('../core/library.cjs').installerCommand(target, folder)
    : null;
  const command =
    'try { $process = Start-Process -FilePath ' +
    quote(plan?.file || target) +
    ' -WorkingDirectory ' +
    quote(path.dirname(target)) +
    (plan
      ? ' -ArgumentList ' +
        quote(
          plan.args
            .map((arg) => (plan.windowsVerbatimArguments ? arg : commandLineArgument(arg)))
            .join(' '),
        )
      : '') +
    ' -Verb RunAs -ErrorAction Stop' +
    (wait ? ' -Wait -PassThru; if ($process.ExitCode -notin @(0, 3010)) { exit 1 }' : '') +
    '; exit 0 } catch { if ($_.Exception.NativeErrorCode -eq 1223 -or $_.Exception.InnerException.NativeErrorCode -eq 1223) { exit 2 }; exit 1 }';
  return new Promise((resolve, reject) => {
    const child = spawn(
      path.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(command, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, stdio: 'ignore', shell: false },
    );
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolve(true)
        : code === 2
          ? resolve(false)
          : reject(
              Error(
                'Windows could not start setup as administrator. Check file permissions or security software.',
              ),
            ),
    );
  });
}

module.exports = { runSetupAsAdministrator };

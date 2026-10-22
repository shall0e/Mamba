const path = require('node:path');
function normalizeLaunchOptions(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Invalid launch options.');
  const args = value.arguments ?? '';
  const workingDirectory = value.workingDirectory ?? '';
  if (typeof args !== 'string' || args.length > 4096 || /[\0\r\n]/.test(args))
    throw Error('Launch arguments must be a single line of up to 4096 characters.');
  if (
    typeof workingDirectory !== 'string' ||
    workingDirectory.length > 2048 ||
    /[\0\r\n]/.test(workingDirectory)
  )
    throw Error('Invalid working directory.');
  return { arguments: args.trim(), workingDirectory: workingDirectory.trim() };
}
function parseArguments(text) {
  const args = [];
  let value = '',
    quoted = false,
    started = false;
  for (let i = 0; i < text.length; i++) {
    let slashes = 0;
    while (text[i] === '\\') {
      slashes++;
      i++;
    }
    if (text[i] === '"') {
      value += '\\'.repeat(Math.floor(slashes / 2));
      if (slashes % 2) value += '"';
      else quoted = !quoted;
      started = true;
    } else {
      value += '\\'.repeat(slashes);
      if (i >= text.length) break;
      if (/\s/.test(text[i]) && !quoted) {
        if (started || value) args.push(value);
        value = '';
        started = false;
      } else {
        value += text[i];
        started = true;
      }
    }
  }
  if (quoted) throw Error('Close the quotation marks in launch arguments.');
  if (started || value) args.push(value);
  return args;
}
function launchConfiguration(game) {
  const options = normalizeLaunchOptions(game.launchOptions);
  const cwd = options.workingDirectory
    ? require('./library.cjs').within(
        game.folder,
        path.resolve(game.folder, options.workingDirectory),
      )
    : path.dirname(game.executable);
  return { ...options, cwd, argv: parseArguments(options.arguments) };
}
module.exports = { normalizeLaunchOptions, parseArguments, launchConfiguration };

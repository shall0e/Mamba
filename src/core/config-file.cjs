const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

async function abandonedLock(lock) {
  const owner = Number(await fs.readFile(path.join(lock, 'owner'), 'utf8').catch(() => ''));
  if (Number.isSafeInteger(owner) && owner > 0) {
    try {
      process.kill(owner, 0);
    } catch (error) {
      return error.code === 'ESRCH';
    }
    return false;
  }
  const stat = await fs.stat(lock).catch(() => null);
  return stat && Date.now() - stat.birthtimeMs > 30000;
}

async function withConfigLock(file, update) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const lock = file + '.lock';
  const deadline = Date.now() + 10000;
  for (;;) {
    try {
      await fs.mkdir(lock);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // Never add recovery files to a live lock while its owner may be releasing it.
      if (await abandonedLock(lock)) {
        const recovery = path.join(lock, 'reaping');
        let reaping = false;
        try {
          await fs.mkdir(recovery);
          reaping = true;
          if (await abandonedLock(lock)) {
            reaping = false;
            await fs.rm(lock, { recursive: true, force: true });
            continue;
          }
        } catch (cause) {
          if (!['EEXIST', 'ENOENT'].includes(cause.code)) throw cause;
        } finally {
          if (reaping) await fs.rmdir(recovery).catch(() => {});
        }
      }
      if (Date.now() >= deadline) throw Error('Settings are busy. Please retry.');
      await delay(25);
    }
  }
  try {
    await fs.writeFile(path.join(lock, 'owner'), String(process.pid), { mode: 0o600 });
    return await update();
  } finally {
    await fs.rm(lock, { recursive: true, force: true });
  }
}

async function writePrivateConfig(file, config) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temporary, JSON.stringify(config, null, 2) + '\n', {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

module.exports = { withConfigLock, writePrivateConfig };

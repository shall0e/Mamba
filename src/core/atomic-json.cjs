const fs = require('node:fs/promises');
const path = require('node:path');

async function atomicJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file + '.tmp', JSON.stringify(data), 'utf8');
  await fs.rename(file + '.tmp', file);
}

module.exports = { atomicJson };

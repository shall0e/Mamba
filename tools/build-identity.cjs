const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

function buildIdentity(root = path.resolve(__dirname, '..')) {
  const hash = createHash('sha256');
  function add(relative) {
    const file = path.join(root, relative);
    if (fs.statSync(file).isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) add(relative + '/' + name);
    } else {
      // Git checkouts can use different line endings on Windows and Linux.
      const bytes = fs.readFileSync(file);
      const content = /\.(?:cjs|js|json|html|css|md|txt|ps1|cmd|svg)$/.test(relative)
        ? Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'))
        : bytes;
      hash.update(relative + '\0' + content.length + '\0');
      hash.update(content);
    }
  }
  for (const entry of ['package.json', 'package-lock.json', 'src', 'assets', 'tools']) add(entry);
  return hash.digest('hex');
}
module.exports = { buildIdentity };

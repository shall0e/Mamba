const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-cli-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const cli = async (...args) =>
    promisify(execFile)(process.execPath, [path.resolve('tools/mamba-cli.cjs'), ...args], {
      env: { ...process.env, MAMBA_DATA_DIR: directory },
      timeout: 10000,
    });
  return { directory, cli };
}
test('CLI configuration and sources use launcher validation and redact secrets', async (t) => {
  const { directory, cli } = await fixture(t);
  await cli('config', 'set', 'autoInstall', 'false');
  await cli('config', 'set', 'torboxApiKey', 'fixture-private-key');
  await cli('sources', 'add', 'https://example.test/source.json');
  await cli('sources', 'add', 'https://example.test/source.json');
  const { stdout } = await cli('config', 'list', '--json');
  assert.equal(JSON.parse(stdout).autoInstall, false);
  assert.equal(stdout.includes('fixture-private-key'), false);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(directory, 'config.json'))).sourceUrls.length,
    1,
  );
  await assert.rejects(cli('config', 'set', 'autoInstall', 'wrong'), /must be true or false/);
  await assert.rejects(cli('sources', 'add', 'file:///secret'), /HTTP or HTTPS/);
});
test('CLI AppID search uses cached Steam identity, groups releases and does not refresh sources', async (t) => {
  const { directory, cli } = await fixture(t);
  await fs.writeFile(
    path.join(directory, 'config.json'),
    JSON.stringify({ sourceUrls: ['http://127.0.0.1:1/unreachable'] }),
  );
  const games = ['one', 'two'].map((id) => ({
    id,
    name: 'Left 4 Dead 2',
    sources: [id],
    links: [{ kind: 'torrents', uri: 'magnet:?xt=urn:btih:' + 'a'.repeat(40) }],
  }));
  await fs.writeFile(path.join(directory, 'catalog.json'), JSON.stringify({ games }));
  const app = {
    steamId: 550,
    name: 'Left 4 Dead 2',
    type: 'game',
    cover: 'https://example.test/cover.jpg',
  };
  await fs.writeFile(
    path.join(directory, 'game-identities.json'),
    JSON.stringify([['app:550', { at: Date.now(), data: app }]]),
  );
  const { stdout, stderr } = await cli('search', '550', '--json');
  const result = JSON.parse(stdout);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, 'steam:550');
  assert.equal(stderr.includes('Refreshing'), false);
  const named = JSON.parse((await cli('search', 'left', '4', 'dead', '2', '--json')).stdout);
  assert.equal(named.items.length, 1);
  assert.equal(named.items[0].id, 'steam:550');
  assert.equal((await fs.readdir(directory)).includes('cli'), false);
  await fs.writeFile(path.join(directory, 'steam-source-index.json'), '{broken cache');
  assert.equal(JSON.parse((await cli('search', '550', '--json')).stdout).items[0].id, 'steam:550');
  games.push({
    id: 'new-release',
    name: 'Left 4 Dead 2',
    sources: ['new'],
    links: [{ kind: 'torrents', uri: 'magnet:?xt=urn:btih:' + 'b'.repeat(40) }],
  });
  await fs.writeFile(path.join(directory, 'catalog.json'), JSON.stringify({ games }));
  const updated = JSON.parse((await cli('search', '550', '--json')).stdout);
  assert.ok(updated.items[0].options.some((option) => option.gameId === 'new-release'));
});

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const script = fs.readFileSync(require.resolve('../src/renderer/scripts/artwork-cache.js'), 'utf8');
test('artwork consumers share one request and reuse successful images', async () => {
  let calls = 0,
    resolve;
  const window = {
    mamba: {
      artwork: () => {
        calls++;
        return new Promise((r) => (resolve = r));
      },
    },
  };
  vm.runInNewContext(script, { window, Date });
  const first = window.MambaArtwork.get('game'),
    second = window.MambaArtwork.get('game');
  assert.equal(first, second);
  assert.equal(calls, 1);
  resolve('data:image/png;base64,fixture');
  assert.equal(await first, await second);
  assert.equal(await window.MambaArtwork.get('game'), 'data:image/png;base64,fixture');
  assert.equal(calls, 1);
});
test('failed artwork can be retried rather than poisoning the shared cache', async () => {
  let calls = 0;
  const window = {
    mamba: {
      artwork: async () => {
        if (++calls === 1) throw Error('offline');
        return 'image';
      },
    },
  };
  vm.runInNewContext(script, { window, Date });
  await assert.rejects(window.MambaArtwork.get('game'), /offline/);
  assert.equal(await window.MambaArtwork.get('game'), 'image');
  assert.equal(calls, 2);
});

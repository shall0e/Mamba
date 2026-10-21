const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'),
  os = require('node:os'),
  path = require('node:path');
const { SteamSearch, sourceMatches, titleKey } = require('../src/core/steam-search.cjs');
const { Catalog } = require('../src/core/catalog.cjs');
const release = (id, name, hash) => ({
  id,
  name,
  sources: [id],
  links: [{ kind: 'torrents', uri: 'magnet:?xt=urn:btih:' + hash.repeat(40), cached: true }],
});
test('Steam identities own cards; variants merge and unsupported Steam results are hidden', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-steam-search-'));
  t.after(async () => {
    await Promise.all([...search.searches.values()].map((state) => state.work));
    await search.writes;
    await fs.rm(dir, { recursive: true, force: true });
  });
  const catalog = new Catalog(dir, async () => ({ cachedOnly: true }), {
    apiFactory: () => ({ cached: async () => new Set(['a'.repeat(40), 'b'.repeat(40)]) }),
  });
  catalog.replace([
    release('one', 'Project Zomboid PC', 'a'),
    release('two', 'Project Zomboid License GOG', 'b'),
    release('weak', 'Project Zomboid Something Else', 'c'),
    release('tool', 'Tool', 'd'),
  ]);
  let calls = 0;
  const identity = {
    details: async (id) => ({
      steamId: id,
      name: id === 108600 ? 'Project Zomboid' : 'Tool',
      type: id === 108600 ? 'game' : 'music',
      cover: 'https://example.com/' + id + '.jpg',
    }),
    save: async () => {},
  };
  const search = new SteamSearch(dir, catalog, identity, async () => {
    calls++;
    return Response.json({
      items: [
        { id: 108600, name: 'Project Zomboid' },
        { id: 108600, name: 'Project Zomboid' },
        { id: 999, name: 'Unrelated Game' },
        { id: 10, name: 'Tool' },
      ],
    });
  });
  catalog.steamSearch = search;
  assert.equal((await search.search('zomboid')).pending, true);
  await search.searches.get('zomboid').work;
  const result = await search.search('zomboid');
  assert.equal(result.total, 1);
  assert.equal(result.items[0].id, 'steam:108600');
  assert.equal(result.items[0].options.length, 2);
  assert.equal(result.items[0].name, 'Project Zomboid');
  assert.ok(result.items[0].cover);
  assert.equal((await catalog.resolveGame('steam:108600')).options.length, 2);
  await search.search('zomboid');
  assert.equal(calls, 1);
  catalog.replace([]);
  assert.equal(search.get('steam:108600'), null);
  await assert.rejects(catalog.resolveGame('steam:108600'), /no longer/);
});
test('title matching preserves sequel order, remasters and explicit release years', () => {
  assert.ok(
    sourceMatches(
      { name: 'Call.of.Duty.4.Modern.Warfare.Remastered [Repack]' },
      { name: 'Call of Duty: Modern Warfare Remastered (2017)' },
    ),
  );
  assert.ok(
    sourceMatches(
      { name: 'COD Modern Warfare III [ENG]' },
      { name: 'Call of Duty: Modern Warfare III' },
    ),
  );
  assert.ok(
    !sourceMatches(
      { name: 'Call of Duty 4 Modern Warfare' },
      { name: 'Call of Duty Modern Warfare 4' },
    ),
  );
  assert.ok(
    !sourceMatches(
      { name: 'Call of Duty Modern Warfare 3 (2011)' },
      { name: 'Call of Duty Modern Warfare III (2023)' },
    ),
  );
  assert.ok(!sourceMatches({ name: 'Portal 2' }, { name: 'Portal' }));
  assert.equal(titleKey('Constructor'), 'constructor');
});
test('ambiguous sources and update-only releases stay excluded', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-steam-ambiguous-'));
  t.after(async () => {
    await Promise.all([...search.searches.values()].map((state) => state.work));
    await search.writes;
    await fs.rm(dir, { recursive: true, force: true });
  });
  const catalog = new Catalog(dir, () => ({}));
  catalog.replace([
    release('ambiguous', 'Example Game', 'a'),
    release('patch', 'Other Game [Update only]', 'b'),
  ]);
  const identity = {
    details: async (id) => ({
      steamId: id,
      type: 'game',
      name: id === 3 ? 'Other Game' : id === 1 ? 'Example Game (2007)' : 'Example Game (2023)',
      cover: 'https://example.com/header.jpg',
    }),
    save: async () => {},
  };
  const search = new SteamSearch(dir, catalog, identity, async () =>
    Response.json({
      items: [
        { id: 1, name: 'Example Game (2007)' },
        { id: 2, name: 'Example Game (2023)' },
        { id: 3, name: 'Other Game' },
      ],
    }),
  );
  await search.search('game');
  await search.searches.get('game').work;
  const result = await search.search('game');
  assert.equal(result.total, 0);
  assert.deepEqual(result.items, []);
  assert.equal(result.bestMatch, null);
});
test('cached verified games return while Steam is still pending, without duplicate lookups', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-fast-search-'));
  t.after(async () => {
    await Promise.all([...search.searches.values()].map((state) => state.work));
    await search.writes;
    await fs.rm(dir, { recursive: true, force: true });
  });
  const catalog = new Catalog(dir, () => ({}));
  catalog.replace([release('portal', 'Portal', 'a')]);
  const app = {
    steamId: 620,
    name: 'Portal',
    type: 'game',
    cover: 'https://shared.fastly.steamstatic.com/portal.jpg',
  };
  let respond,
    calls = 0;
  const identity = {
    cache: new Map([['app:620', { data: app }]]),
    details: async () => app,
    save: async () => {},
  };
  const search = new SteamSearch(dir, catalog, identity, () => {
    calls++;
    return new Promise((resolve) => (respond = resolve));
  });
  await search.load();
  const events = [];
  search.onResults = (query, result) => events.push({ query, result });
  const initial = await Promise.race([
    search.search('portal'),
    new Promise((resolve) => setImmediate(() => resolve(null))),
  ]);
  assert.ok(initial, 'the local result must not await Steam');
  assert.equal(initial.items[0].steamId, 620);
  assert.equal(initial.pending, true);
  assert.equal(initial.bestMatch.id, 'steam:620');
  const work = search.searches.get('portal').work;
  await search.search('portal');
  assert.equal(search.searches.get('portal').work, work);
  assert.equal(calls, 1);
  respond(Response.json({ items: [{ id: 620, name: 'Portal' }] }));
  await work;
  assert.equal(events.at(-1).result.pending, false);
  assert.equal((await search.search('portal')).pending, false);
});

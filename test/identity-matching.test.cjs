const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { releaseHints, assessIdentity, identityKey } = require('../src/core/identity-match.cjs');
const {
  sourceMatches,
  topicQueries,
  chooseBestMatch,
  SteamSearch,
} = require('../src/core/steam-search.cjs');
const { GameIdentity } = require('../src/core/game-identity.cjs');
const { Catalog } = require('../src/core/catalog.cjs');

test('identity preserves embedded years, rejects reboots and honors original release evidence', () => {
  const raw = 'Call of Duty [L] [ENG / ENG] (2003, FPS) (1.0)';
  assert.equal(releaseHints(raw).year, '2003');
  assert.equal(sourceMatches({ name: raw }, { name: 'Call of Duty', releaseDate: '2022' }), false);
  assert.equal(
    sourceMatches({ name: raw }, { name: 'Call of Duty (2003)', releaseDate: '2006' }),
    true,
  );
  assert.equal(assessIdentity(raw, { name: 'Call of Duty', releaseDate: '2006' }).accepted, false);
  assert.equal(
    assessIdentity(raw, { name: 'Call of Duty', releaseDate: '2006', originalReleaseYear: '2003' })
      .accepted,
    true,
  );
  assert.equal(assessIdentity('Example Remake', { name: 'Example' }).accepted, false);
  assert.notEqual(
    identityKey('Example (2003)', 'example'),
    identityKey('Example (2022)', 'example'),
  );
});

test('one conflicting Steam result cannot become verified or poison another year', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-identity-match-'));
  const identity = new GameIdentity(directory, async (url) =>
    String(url).includes('storesearch')
      ? Response.json({ items: [{ id: 123, name: 'Example' }] })
      : Response.json({
          123: {
            success: true,
            data: { name: 'Example', type: 'game', release_date: { date: '2022' } },
          },
        }),
  );
  t.after(async () => {
    await identity.writes;
    await fs.rm(directory, { recursive: true, force: true });
  });
  assert.equal((await identity.identify('Example (2003, FPS)')).verified, false);
  assert.equal((await identity.identify('Example (2022)')).verified, true);
});

test('query expansion includes unnumbered first games and preserves exact sequel query first', () => {
  assert.ok(topicQueries('Modern Warfare 1').includes('Modern Warfare'));
  assert.equal(topicQueries('Portal 2')[0], 'Portal 2');
  assert.ok(topicQueries('Portal 2').includes('portal'));
  assert.equal(topicQueries('F1 2024')[0], 'F1 2024');
});

test('best banner needs one verified exact match; newest requires explicit intent', () => {
  const first = { id: 'one', name: 'Example', verified: true, releaseYear: '2003' };
  const reboot = { id: 'two', name: 'Example', verified: true, releaseYear: '2022' };
  assert.equal(chooseBestMatch('Example', [first]), first);
  assert.equal(chooseBestMatch('Example', [first, reboot]), null);
  assert.equal(chooseBestMatch('Example 2003', [first, reboot]), first);
  assert.equal(chooseBestMatch('newest Example', [first, reboot]), reboot);
  assert.equal(chooseBestMatch('Example', [first, { ...reboot, verified: false }]), null);
  assert.equal(
    chooseBestMatch('Modern Warfare 1', [{ name: 'Modern Warfare', verified: true }]).name,
    'Modern Warfare',
  );
});

test('first-game expansion returns unique confirmed games and related sequels', async () => {
  const catalog = new Catalog('unused', async () => ({}));
  catalog.replace(
    ['Modern Warfare', 'Modern Warfare 2'].map((name, i) => ({
      id: String(i),
      name,
      sources: ['fixture'],
      links: [{ kind: 'torrents', uri: 'magnet:?xt=urn:btih:' + String(i + 1).repeat(40) }],
    })),
  );
  const search = new SteamSearch('unused', catalog, {});
  for (const [i, name] of ['Modern Warfare', 'Modern Warfare 2'].entries()) {
    search.apps.set('steam:' + (i + 1), { steamId: i + 1, name, type: 'game' });
  }
  const result = search.localResults('Modern Warfare 1');
  assert.equal(result.total, 2);
  assert.equal(result.items[0].name, 'Modern Warfare');
  assert.equal(result.items[0].related, false);
  assert.equal(result.items[1].related, true);
  assert.ok(result.items.every((game) => game.verified && !game.identityUncertain));
  assert.equal(new Set(result.items.map((game) => game.id)).size, result.total);
  assert.equal(result.bestMatch.id, 'steam:1');
});

test('year-specific releases attach only to the matching app and never borrow a launcher cover', () => {
  const catalog = new Catalog('unused', async () => ({}));
  catalog.replace([
    {
      id: 'old',
      name: 'Call of Duty [ENG] (2003, FPS)',
      sources: ['fixture'],
      links: [{ kind: 'torrents', uri: 'magnet:?xt=urn:btih:' + 'a'.repeat(40) }],
    },
    {
      id: 'new',
      name: 'Call of Duty [ENG] (2022, FPS)',
      sources: ['fixture'],
      links: [{ kind: 'torrents', uri: 'magnet:?xt=urn:btih:' + 'b'.repeat(40) }],
    },
  ]);
  const search = new SteamSearch('unused', catalog, {});
  search.apps.set('steam:1', {
    steamId: 1,
    name: 'Call of Duty (2003)',
    type: 'game',
    releaseDate: '2006',
    cover: 'https://example.test/original.png',
  });
  search.apps.set('steam:2', {
    steamId: 2,
    name: 'Call of Duty',
    type: 'game',
    releaseDate: '2022',
    isHub: true,
    cover: 'https://example.test/launcher.png',
  });
  const result = search.localResults('call of duty');
  assert.equal(result.total, 1);
  const old = result.items.find((game) => game.id === 'steam:1');
  assert.deepEqual(
    old.options.map((option) => option.gameId),
    ['old'],
  );
  assert.equal(old.releaseYear, '2003');
  assert.ok(result.items.every((game) => game.verified && !game.identityUncertain));
  assert.ok(!result.items.some((game) => game.id === 'steam:2'));
  assert.equal(result.bestMatch.id, 'steam:1');
  assert.equal(search.localResults('call of duty 2003').bestMatch.id, 'steam:1');
});

test('modifications and numbered sequels do not silently claim base-game identities', () => {
  assert.equal(assessIdentity('Example [Mod]', { name: 'Example' }).accepted, false);
  assert.equal(
    sourceMatches({ name: 'Example Game 2 Remastered' }, { name: 'Example Game Remastered' }),
    false,
  );
  assert.equal(
    sourceMatches(
      { name: 'Example Franchise 4 Distinct Subtitle Remastered' },
      { name: 'Example Franchise Distinct Subtitle Remastered' },
    ),
    true,
  );
});

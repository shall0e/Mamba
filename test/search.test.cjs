const test = require('node:test');
const assert = require('node:assert/strict');
const { createSearchIndex, rankedSearch, optionTraits } = require('../src/core/search.cjs');
const { Catalog } = require('../src/core/catalog.cjs');
const game = (id, name, hash, sources = ['Source']) => ({
  id,
  name,
  fileSize: '6 GB',
  sources,
  links: [{ uri: `magnet:?xt=urn:btih:${hash.repeat(40)}`, kind: 'torrents', cached: true }],
});

test('store, platform, early access and magnet labels share a single game card', () => {
  const names = [
    'Project Zomboid',
    'Project Zomboid PC',
    'Project Zomboid (Early Access)',
    'Project Zomboid License GOG',
    'Project Zomboid Magnet Link',
    'Project Zomboid РС',
  ];
  const index = createSearchIndex(
    names.map((name, i) => game('release' + i, name, String(i), ['Source' + i])),
  );
  const results = rankedSearch(index, 'project zomboid');
  assert.equal(results.total, 1);
  assert.equal(results.items[0].name, 'Project Zomboid');
  assert.equal(results.items[0].options.length, 6);
  assert.equal(results.items[0].sources.length, 6);
  assert.deepEqual(
    results.items[0].options.map((option) => option.release),
    names,
  );
  const separate = createSearchIndex(
    [
      'Project Zomboid',
      'Project Zomboid 2',
      'Project Zomboid Remastered',
      'PC Building Simulator',
    ].map((name, i) => game('g' + i, name, String(i))),
  );
  assert.equal(separate.length, 4);
  assert.equal(separate[3].name, 'PC Building Simulator');
});

test('numeric queries match title words and ignore metadata versions, years, and language counts', () => {
  const index = createSearchIndex([
    game('exact', 'Call of Duty: Modern Warfare 4 [P] (2026, FPS) (25909941, Campaign Only)', 'a'),
    game('classic', 'Call of Duty 4: Modern Warfare [ENG] (2007) (1.7)', 'b'),
    game('year', 'Call of Duty Collection (2004—2012)', 'c'),
    game('metadata', 'Call of Duty: Modern Warfare III [RUS + ENG + 4] (2023) (10.4)', 'd'),
    game('dots', 'Call.of.Duty.Modern.Warfare.III.v10.4-P2P', 'e'),
  ]);
  const result = rankedSearch(index, 'modern warfare 4');
  assert.deepEqual(
    result.items.map((item) => item.id),
    ['exact', 'classic'],
  );
});
test('groups equivalent releases, deduplicates hashes, and preserves the source release and link index', () => {
  const index = createSearchIndex([
    game('dodi', 'Call of Duty 4: Modern Warfare - [DODI Repack]', 'a', ['One']),
    game('steam', 'Call of Duty 4: Modern Warfare [L] [RUS / ENG] (2007) (1.7) [Steam-Rip]', 'b', [
      'Two',
    ]),
    game('mirror', 'Call of Duty 4: Modern Warfare [ENG / ENG] (2007, FPS) (1.0)', 'b', ['Three']),
    game('remastered', 'Call of Duty 4 Modern Warfare Remastered [RePack]', 'c'),
    game('sequel', 'Call of Duty Modern Warfare II (2022) [RePack]', 'd'),
  ]);
  const result = rankedSearch(index, 'modern warfare 4');
  assert.equal(result.total, 3);
  // Undated releases remain separate until identity evidence establishes their year.
  const classic = result.items.find((item) => item.releaseYear === '2007');
  assert.equal(classic.name, 'Call of Duty 4: Modern Warfare');
  assert.equal(classic.options.length, 1);
  assert.equal(classic.options[0].gameId, 'steam');
  assert.equal(classic.options[0].linkIndex, 0);
  assert.deepEqual(classic.options[0].sources, ['Two', 'Three']);
  assert.ok(result.items.some((item) => /Remastered/.test(item.name)));
});
test('exact single-game matches precede collections and partial queries remain useful', () => {
  const index = createSearchIndex([
    game('collection', 'Portal Collection', 'a'),
    game('exact', 'Portal', 'b'),
    game('sequel', 'Portal 2', 'c'),
  ]);
  assert.equal(rankedSearch(index, 'portal').items[0].id, 'exact');
  assert.equal(rankedSearch(index, 'port').total, 3);
  assert.equal(rankedSearch(index, 'portal', 1).items[0].id, 'sequel');
});

test('search groups campaign and deluxe variants under the game, while remasters stay separate', () => {
  const index = createSearchIndex([
    game('base', 'Example Game', 'a'),
    game('campaign', 'Example Game Campaign [Repack]', 'b'),
    game('deluxe', 'Example Game - Deluxe Edition', 'c'),
    game('remaster', 'Example Game Remastered', 'd'),
  ]);
  const result = rankedSearch(index, 'example game');
  assert.equal(result.total, 2);
  assert.equal(result.items[0].options.length, 3);
  assert.equal(result.items[0].name, 'Example Game');
});

test('Linux vendor tags are detected even without a trailing word boundary', () => {
  assert.equal(
    optionTraits({
      release: "Garry's Mod (v.build 25375506 17.09.26) [MULTi] [Goldberg] [LinuxRuleZ!]",
    }).incompatible,
    true,
  );
  assert.equal(optionTraits({ release: 'Example Game [LinuxRulez]' }).incompatible, true);
  assert.equal(optionTraits({ release: 'Example Game [Linux ENG]' }).incompatible, true);
  assert.equal(
    optionTraits({ release: 'Example Game [LinuxRuleZ!] [Windows]' }).incompatible,
    false,
  );
});

test('opening a game rechecks availability and chooses a current English release over stale, Russian-only, patch, and Linux options', async () => {
  let cached = new Set(['a', 'b', 'd', 'e', 'f'].map((c) => c.repeat(40)));
  const catalog = new Catalog(
    'unused-test-directory',
    async () => ({ torboxApiKey: 'fixture', cachedOnly: true }),
    { apiFactory: () => ({ cached: async () => cached }) },
  );
  catalog.replace([
    game('old', 'Example Game [ENG] (1.9)', 'a'),
    game('new', 'Example Game [ENG] (1.10)', 'b'),
    game('stale', 'Example Game [ENG] (2.0)', 'c'),
    game('russian', 'Example Game [RUS] (3.0)', 'd'),
    game('patch', 'Example Game [Update only] [ENG] (9.0)', 'e'),
    game('linux', 'Example Game [Linux ENG] (10.0)', 'f'),
  ]);
  let resolved = await catalog.resolveGame('old');
  assert.equal(resolved.best.gameId, 'new');
  assert.equal(resolved.options.find((option) => option.gameId === 'stale').available, false);
  assert.equal(resolved.options.length, 6);
  cached = new Set(['a'.repeat(40)]);
  resolved = await catalog.resolveGame('old');
  assert.equal(resolved.best.gameId, 'old');
  cached = new Set(['e'.repeat(40), 'f'.repeat(40)]);
  resolved = await catalog.resolveGame('old');
  assert.equal(resolved.best, null);
});

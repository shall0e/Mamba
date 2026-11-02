const test = require('node:test'),
  assert = require('node:assert/strict');
const { sidebarRecent } = require('../src/shared/activity-metrics.js');
test('only the newest unplayed install is pinned; playing it saves it into history', () => {
  const played = { id: 'played', lastPlayed: '2026-11-01T10:00:00Z', installedAt: '2026-10-01' };
  const first = { id: 'first', installedAt: '2026-11-01T11:00:00Z' };
  const second = { id: 'second', installedAt: '2026-11-01T12:00:00Z' };
  const ids = (games) => sidebarRecent(games).map((g) => g.id);
  assert.deepEqual(ids([played, first]), ['first', 'played']);
  assert.deepEqual(ids([played, first, second]), ['second', 'played']);
  const saved = { ...second, lastPlayed: '2026-11-01T13:00:00Z' };
  assert.deepEqual(ids([played, first, saved]), ['second', 'played']);
  const third = { id: 'third', installedAt: '2026-11-01T14:00:00Z' };
  assert.deepEqual(ids([played, first, saved, third]), ['third', 'second', 'played']);
  assert.deepEqual(ids([{ ...third, lastPlayed: '2026-11-01T15:00:00Z' }, saved, played, first]), [
    'third',
    'second',
    'played',
  ]);
});
test('reinstalled played games are pinned without duplicating their history', () => {
  const game = { id: 'one', lastPlayed: '2026-10-01', installedAt: '2026-11-01' };
  assert.deepEqual(
    sidebarRecent([game]).map((g) => g.id),
    ['one'],
  );
  assert.deepEqual(sidebarRecent([{ id: 'unknown', installedAt: 'invalid' }]), []);
});

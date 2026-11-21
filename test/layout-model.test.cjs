const test = require('node:test');
const assert = require('node:assert/strict');
const layouts = require('../src/shared/layout-model.js');
const themes = require('../src/shared/theme-model.js');

test('an empty layout resolves to the original design', () => {
  const card = layouts.resolve(null, 'result-card');
  assert.equal(card.variant, 'stacked');
  assert.deepEqual(card.slots, ['artwork', 'title', 'meta', 'services', 'action']);
  assert.equal(card.style.radius, 8);
  assert.equal(layouts.cssVariables(null)['--result-grid-columns'], '5');
  assert.equal(layouts.cssVariables(null)['--result-card-title-lines'], '2');
});

test('themes control variant, slot order, visibility and style tokens', () => {
  const layout = layouts.parse({
    version: 1,
    components: {
      'result-card': {
        variant: 'overlay',
        slots: ['title', 'artwork', 'action'],
        style: { radius: 0, action: 'icon' },
      },
    },
  });
  const card = layouts.resolve(layout, 'result-card');
  assert.equal(card.variant, 'overlay');
  assert.deepEqual(card.slots, ['title', 'artwork', 'action']);
  assert.equal(card.style.radius, 0);
  assert.equal(card.style.padding, 16);
  assert.deepEqual(layouts.attributes(layout, 'result-card'), {
    variant: 'overlay',
    surface: 'foreground',
    border: 'line',
    action: 'icon',
  });
});

test('unknown parts from newer themes are ignored with warnings', () => {
  const { layout, warnings } = layouts.inspect({
    components: {
      'future-widget': {},
      'result-card': { slots: ['artwork', 'rating', 'artwork'], style: { glow: 3 } },
    },
  });
  assert.deepEqual(layout.components['result-card'].slots, ['artwork']);
  assert.equal(warnings.length, 3);
});

test('broken layouts are rejected with readable errors', () => {
  assert.throws(() => layouts.parse([]), /must be an object/);
  assert.throws(() => layouts.parse({ version: 2 }), /newer version/);
  assert.throws(
    () => layouts.parse({ components: { 'result-card': { variant: 'spiral' } } }),
    /Unknown variant/,
  );
  assert.throws(
    () => layouts.parse({ components: { 'result-card': { slots: ['meta'] } } }),
    /at least one of/,
  );
  assert.throws(
    () => layouts.parse({ components: { 'result-grid': { style: { columns: 9 } } } }),
    /1–5/,
  );
  assert.throws(
    () => layouts.parse({ components: { 'result-card': { style: { radius: '8px' } } } }),
    /0–24/,
  );
  // Style values are numbers or fixed keywords only, never raw CSS.
  assert.throws(
    () =>
      layouts.parse({
        components: { 'result-card': { style: { surface: 'url(https://example.test)' } } },
      }),
    /must be one of/,
  );
});

test('game details sections and header default to the original page', () => {
  const page = layouts.resolve(null, 'game-details');
  assert.deepEqual(page.slots, [
    'back',
    'hero',
    'metadata',
    'overview',
    'media',
    'installation',
    'content',
    'downloads',
  ]);
  assert.equal(page.style.width, 900);
  const hero = layouts.resolve(null, 'detail-hero');
  assert.equal(hero.variant, 'cinematic');
  assert.equal(layouts.cssVariables(null)['--detail-hero-art-width'], '900px');
  const reordered = layouts.parse({
    components: {
      'game-details': { slots: ['hero', 'downloads', 'overview'] },
      'detail-hero': { variant: 'split', slots: ['title', 'actions', 'artwork'] },
    },
  });
  assert.deepEqual(layouts.resolve(reordered, 'game-details').slots, [
    'hero',
    'downloads',
    'overview',
  ]);
  assert.throws(
    () => layouts.parse({ components: { 'game-details': { slots: ['overview'] } } }),
    /at least one of/,
  );
  assert.throws(
    () => layouts.parse({ components: { 'detail-hero': { slots: ['artwork'] } } }),
    /Game title/,
  );
});

test('theme files carry their layout and older themes are unchanged', () => {
  const base = themes.parse(themes.presets[0]);
  assert.equal(base.layout, undefined);
  const custom = themes.parse({
    ...themes.presets[0],
    name: 'Rows',
    layout: { components: { 'result-card': { variant: 'row' } } },
  });
  assert.deepEqual(custom.layout, {
    version: 1,
    components: { 'result-card': { variant: 'row' } },
  });
  assert.equal(
    themes.parse({ ...themes.presets[0], layout: { components: {} } }).layout,
    undefined,
  );
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const presence = require('../src/shared/game-presence.js');
const activity = require('../src/shared/activity-metrics.js');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.style = {};
    this.classList = { add() {} };
    this.isConnected = true;
    this.value = '';
  }
  append(...children) {
    this.children.push(...children);
  }
  replaceChildren(...children) {
    this.children = children;
    this.text = '';
  }
  get lastChild() {
    return this.children.at(-1);
  }
  get firstChild() {
    return this.children[0];
  }
  set textContent(value) {
    this.text = value ?? '';
    this.children = [];
  }
  get textContent() {
    return this.text || this.children.map((child) => child.textContent || '').join('');
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  getAttribute(name) {
    return this.attributes[name];
  }
  removeAttribute(name) {
    delete this.attributes[name];
  }
  addEventListener(name, action) {
    this.listeners[name] = action;
  }
  remove() {}
  showModal() {}
  close() {}
  focus() {}
  async click() {
    if (!this.disabled) await this.listeners.click?.({});
  }
}
function renderer() {
  const nodes = new Map();
  const select = (selector) => {
    if (selector.startsWith('#icon-')) return null;
    if (!nodes.has(selector)) {
      const element = new Element();
      element.append(new Element('span'));
      nodes.set(selector, element);
    }
    return nodes.get(selector);
  };
  let enqueued = 0;
  const actions = [];
  const context = vm.createContext({
    console,
    installedGames: [],
    currentDetail: null,
    showUnknown: false,
    favoritesOnly: false,
    availability: 'all',
    libraryView: 'cards',
    sort: 'name',
    libraryRenderSignature: '',
    window: {
      MambaPresence: presence,
      MambaActivity: activity,
      MambaArtwork: { get: async () => null },
      MambaExperience: { jobs: [], play: async () => actions.push('play') },
      mamba: {
        downloadBest: async () => {
          enqueued++;
          return 'job';
        },
        retry: async () => actions.push('retry'),
      },
    },
    document: {
      querySelector: select,
      body: new Element('body'),
      activeElement: null,
      createElement: (tag) => new Element(tag),
      createDocumentFragment: () => new Element('fragment'),
    },
    showToast() {},
    showPage: (name) => actions.push(name),
    openGame: async () => actions.push('details'),
    cover() {},
    date: (value) => value,
    node: (tag, text, className) => {
      const element = new Element(tag);
      element.textContent = text;
      element.className = className;
      return element;
    },
    $: select,
  });
  const app = fs.readFileSync(path.join(__dirname, '../src/renderer/scripts/app.js'), 'utf8');
  vm.runInContext(app.slice(0, app.indexOf('function formatBytes')), context);
  context.action = context.button;
  return { context, select, actions, enqueued: () => enqueued };
}
function primary(select) {
  return select('#featured-game').children[2].children[2].children[0];
}

test('featured download stays queued after enqueue resolves and follows download state changes', async () => {
  const { context, select, enqueued, actions } = renderer();
  const game = { id: 'game', name: 'Game' };
  context.renderFeaturedGame(game);
  await primary(select).click();
  assert.equal(primary(select).textContent, 'Queued');
  assert.equal(primary(select).disabled, true);
  await primary(select).click();
  assert.equal(enqueued(), 1);
  for (const status of ['queued', 'downloading', 'needs-setup']) {
    context.window.MambaExperience.jobs = [{ id: 'job', gameId: 'game', status }];
    context.renderFeaturedGame(game);
    assert.equal(primary(select).textContent, 'View download');
    await primary(select).click();
    assert.equal(actions.at(-1), 'activity');
  }
  context.window.MambaExperience.jobs[0].status = 'paused';
  context.renderFeaturedGame(game);
  assert.equal(primary(select).textContent, 'Resume');
  await primary(select).click();
  assert.deepEqual(actions.slice(-2), ['retry', 'activity']);
});

test('featured installed games requiring setup open review instead of offering another download', async () => {
  const { context, select, actions } = renderer();
  context.installedGames = [{ id: 'owned', name: 'Game', status: 'needs-setup' }];
  context.renderFeaturedGame({ id: 'game', name: 'Game' });
  assert.equal(primary(select).textContent, 'Review setup');
  await primary(select).click();
  assert.equal(actions.at(-1), 'details');
});

test('confirmation dialogs describe the actual message with optional detail', () => {
  for (const detail of ['', 'Extra explanation']) {
    const { context } = renderer();
    let onDialog;
    context.window.mamba.onDialog = (handler) => {
      onDialog = handler;
    };
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, '../src/renderer/scripts/dialogs.js'), 'utf8'),
      context,
    );
    onDialog({
      id: 1,
      title: 'Confirm',
      message: 'Delete this game?',
      detail,
      buttons: ['Cancel', 'Delete'],
      defaultId: 0,
      cancelId: 0,
    });
    const popup = context.document.body.lastChild;
    const described = popup.getAttribute('aria-describedby').split(' ');
    assert.ok(described.includes('mamba-dialog-message'));
    assert.equal(described.includes('mamba-dialog-detail'), !!detail);
    assert.equal(
      popup.children.find((child) => child.id === 'mamba-dialog-message').textContent,
      'Delete this game?',
    );
  }
});

test('Home play history refreshes when only lastPlayed changes and cards are reused', () => {
  const { context, select } = renderer();
  const experience = fs.readFileSync(
    path.join(__dirname, '../src/renderer/scripts/experience.js'),
    'utf8',
  );
  vm.runInContext(
    experience.slice(
      experience.indexOf('  function renderLibrary('),
      experience.indexOf('  function renderDownloadOverview('),
    ),
    context,
  );
  const game = {
    id: 'game',
    name: 'Game',
    verified: true,
    steamId: 1,
    status: 'installed',
    executable: 'game.exe',
  };
  context.renderLibrary([game]);
  const firstCard = select('#game-list').firstChild;
  assert.match(select('#recently-played').textContent, /No play history/);
  context.renderLibrary([{ ...game, lastPlayed: '2026-11-03T12:00:00Z' }]);
  assert.equal(select('#game-list').firstChild, firstCard);
  assert.match(select('#recently-played').textContent, /Game/);
  assert.doesNotMatch(select('#recently-played').textContent, /No play history/);
});

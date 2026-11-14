const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const {
  restoreBounds,
  readWindowState,
  trackWindowState,
} = require('../src/main/window-state.cjs');

const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const secondary = { x: 1920, y: 0, width: 2560, height: 1400 };

test('saved bounds are restored on the display that holds the title bar', () => {
  assert.deepEqual(
    restoreBounds({ x: 2000, y: 40, width: 1700, height: 900, maximized: true }, [
      primary,
      secondary,
    ]),
    { x: 2000, y: 40, width: 1700, height: 900, maximized: true },
  );
});

test('off-screen or missing positions fall back to a centered size on the largest display', () => {
  assert.deepEqual(restoreBounds({ x: 5000, y: 3000, width: 1280, height: 720 }, [primary]), {
    width: 1280,
    height: 720,
    maximized: false,
  });
  assert.deepEqual(restoreBounds(null, [primary]), { width: 1100, height: 740, maximized: false });
  assert.deepEqual(restoreBounds({ width: 'wide' }, [primary]), {
    width: 1100,
    height: 740,
    maximized: false,
  });
});

test('oversized windows shrink to the work area and stay inside it', () => {
  assert.deepEqual(restoreBounds({ x: 1500, y: 10, width: 4000, height: 3000 }, [primary]), {
    x: 0,
    y: 0,
    width: 1920,
    height: 1040,
    maximized: false,
  });
  assert.deepEqual(restoreBounds({ x: 10, y: 10, width: 100, height: 50 }, [primary]), {
    x: 10,
    y: 10,
    width: 400,
    height: 300,
    maximized: false,
  });
});

test('window state is saved from normal bounds and read back', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mamba-window-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  assert.equal(await readWindowState(directory), null);
  const window = new EventEmitter();
  window.isDestroyed = () => false;
  window.isMaximized = () => true;
  window.getNormalBounds = () => ({ x: 20, y: 30, width: 1280, height: 720 });
  await trackWindowState(window, directory).save();
  assert.deepEqual(await readWindowState(directory), {
    x: 20,
    y: 30,
    width: 1280,
    height: 720,
    maximized: true,
  });
});

const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_SIZE = { width: 1100, height: 740 };
const MINIMUM_SIZE = { width: 400, height: 300 };
const FILE_NAME = 'window-state.json';

function finite(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
}

// Returns bounds that are fully usable on one of the current displays, or only a size when
// the saved position would be off-screen (for example after a monitor was disconnected).
function restoreBounds(saved, workAreas, defaults = DEFAULT_SIZE) {
  const areas = (workAreas || []).filter(
    (area) => area && area.width > 0 && area.height > 0 && [area.x, area.y].every(Number.isFinite),
  );
  const width = finite(saved?.width),
    height = finite(saved?.height);
  if (!width || !height || !areas.length)
    return { width: defaults.width, height: defaults.height, maximized: !!saved?.maximized };
  const x = finite(saved.x),
    y = finite(saved.y);
  const largest = areas.reduce((best, area) =>
    area.width * area.height > best.width * best.height ? area : best,
  );
  const size = (area) => ({
    width: Math.max(MINIMUM_SIZE.width, Math.min(width, area.width)),
    height: Math.max(MINIMUM_SIZE.height, Math.min(height, area.height)),
  });
  if (x === null || y === null) return { ...size(largest), maximized: !!saved.maximized };
  // Keep the title bar reachable: at least 120px of the top edge must sit on a display.
  const span = Math.max(width, MINIMUM_SIZE.width);
  const home = areas.find(
    (area) =>
      y >= area.y &&
      y < area.y + area.height - 32 &&
      Math.min(x + span, area.x + area.width) - Math.max(x, area.x) >= 120,
  );
  if (!home) return { ...size(largest), maximized: !!saved.maximized };
  const bounded = size(home);
  return {
    x: Math.min(Math.max(x, home.x), home.x + home.width - bounded.width),
    y: Math.min(Math.max(y, home.y), home.y + home.height - bounded.height),
    ...bounded,
    maximized: !!saved.maximized,
  };
}

async function readWindowState(directory) {
  try {
    const saved = JSON.parse(await fs.readFile(path.join(directory, FILE_NAME), 'utf8'));
    return saved && typeof saved === 'object' ? saved : null;
  } catch {
    return null;
  }
}

function trackWindowState(window, directory, { delay = 400 } = {}) {
  let timer;
  let writing = Promise.resolve();
  const capture = () => {
    if (window.isDestroyed()) return null;
    // Normal bounds remember the restored size even while maximized or minimized.
    const bounds = window.getNormalBounds();
    return { ...bounds, maximized: window.isMaximized() };
  };
  const save = () => {
    clearTimeout(timer);
    const state = capture();
    if (!state) return writing;
    writing = writing
      .catch(() => {})
      .then(() => fs.mkdir(directory, { recursive: true }))
      .then(() => fs.writeFile(path.join(directory, FILE_NAME), JSON.stringify(state)))
      .catch(() => {});
    return writing;
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(save, delay);
  };
  for (const event of ['resize', 'move', 'maximize', 'unmaximize']) window.on(event, schedule);
  window.on('close', save);
  return { save };
}

module.exports = { restoreBounds, readWindowState, trackWindowState, DEFAULT_SIZE, MINIMUM_SIZE };

(() => {
  // Optional keyboard navigation. Every shortcut duplicates a visible control, so nothing
  // here is required to use Mamba, and none of it fires while typing in a field.
  const $ = (selector) => document.querySelector(selector);
  const isMac = /Mac/i.test(navigator.platform || '');
  const modifier = isMac ? 'Cmd' : 'Ctrl';
  const editable = (target) =>
    !!target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
  const visiblePage = () =>
    document.querySelector('.page:not([hidden]), #settings-backdrop:not([hidden])');
  const blocked = () =>
    !!document.querySelector('dialog[open], .game-context-menu, .welcome-dialog[open]');
  function goBack() {
    if ($('#game-page')?.hidden !== false) return false;
    const back = $('#game-content > button');
    if (!back) return false;
    back.click();
    return true;
  }
  const pages = { 1: 'search', 2: 'library', 3: 'activity' };
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.isComposing) return;
    const command = isMac ? event.metaKey : event.ctrlKey;
    if (command && !event.altKey && !event.shiftKey) {
      if (pages[event.key] && !blocked()) {
        event.preventDefault();
        showPage(pages[event.key]);
        return;
      }
      if (event.key === ',' && !blocked()) {
        event.preventDefault();
        openSettings();
        return;
      }
      if (event.key.toLowerCase() === 'f' && !blocked()) {
        event.preventDefault();
        if (visiblePage()?.id === 'library-page') {
          $('#library-filter').focus();
          $('#library-filter').select();
        } else {
          showPage('search');
          $('#main-search').select();
        }
        return;
      }
    }
    if (blocked() || editable(event.target)) return;
    const back =
      (event.altKey && event.key === 'ArrowLeft') ||
      (!event.altKey && !command && ['Escape', 'Backspace', 'BrowserBack'].includes(event.key));
    if (back && goBack()) event.preventDefault();
  });
  // Mouse "Back" side button returns from game details like the Back control.
  window.addEventListener('mouseup', (event) => {
    if (event.button === 3 && !blocked() && goBack()) event.preventDefault();
  });

  for (const [id, keys] of [
    ['#search-open', 'Control+1 Meta+1 Control+K Meta+K'],
    ['#library-open', 'Control+2 Meta+2'],
    ['#activity-open', 'Control+3 Meta+3'],
    ['#settings-open', 'Control+, Meta+,'],
  ])
    $(id)?.setAttribute('aria-keyshortcuts', keys);

  const panel = $('#settings-app');
  if (!panel) return;
  const card = document.createElement('section');
  card.className = 'settings-card shortcut-card';
  card.setAttribute('aria-labelledby', 'shortcuts-title');
  const title = document.createElement('h2');
  title.id = 'shortcuts-title';
  title.textContent = 'Keyboard shortcuts';
  const hint = document.createElement('p');
  hint.className = 'field-hint';
  hint.textContent = 'Optional shortcuts for moving around Mamba. They pause while you type.';
  const list = document.createElement('dl');
  list.className = 'shortcut-list';
  for (const [label, ...combos] of [
    ['Search games', [modifier, 'K']],
    ['Home', [modifier, '1']],
    ['Library', [modifier, '2']],
    ['Activity', [modifier, '3']],
    ['Settings', [modifier, ',']],
    ['Find in the current page', [modifier, 'F']],
    ['Back from game details', ['Esc'], ['Alt', '←'], ['Mouse back']],
    ['Browse screenshots', ['←'], ['→']],
    ['Game menu in the sidebar', ['Shift', 'F10']],
  ]) {
    const row = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = label;
    const keys = document.createElement('dd');
    combos.forEach((combo, index) => {
      if (index) {
        const separator = document.createElement('span');
        separator.className = 'shortcut-separator';
        separator.textContent = 'or';
        keys.append(separator);
      }
      for (const key of combo) {
        const kbd = document.createElement('kbd');
        kbd.textContent = key;
        keys.append(kbd);
      }
    });
    row.append(term, keys);
    list.append(row);
  }
  card.append(title, hint, list);
  const updatesCard = $('#updates-title')?.closest('.settings-card');
  if (updatesCard?.parentElement === panel) updatesCard.after(card);
  else panel.append(card);
})();

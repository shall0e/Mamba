(() => {
  const $ = (s) => document.querySelector(s);
  const node = (tag, text, cls) => {
    const el = document.createElement(tag);
    if (text) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  };
  const sidebar = $('.sidebar');
  const header = node('div', undefined, 'sidebar-heading');
  const brand = node('div', undefined, 'sidebar-brand');
  const mark = node('img');
  mark.src = '../../assets/mamba.png';
  mark.alt = '';
  brand.append(mark, node('span', 'mamba'));
  const version = document.querySelector('#search-version');
  mark.replaceWith(
    Object.assign(document.createElement('span'), { className: 'mamba-mark sidebar-brand-mark' }),
  );
  brand.append(version);
  header.append(brand);
  sidebar.prepend(header);
  document.documentElement.dataset.sidebarCollapsed = 'false';
  const recent = node('div', undefined, 'sidebar-recents');
  const groups = {};
  for (const [key, title] of [['played', 'Recently played']]) {
    const section = node('section', undefined, 'sidebar-recent-group');
    section.append(node('h2', title));
    const list = node('div');
    section.append(list);
    groups[key] = list;
    recent.append(section);
  }
  $('#settings-open').before(recent);
  let recentGames = [];
  function recentLimit() {
    const settings = $('#settings-open'),
      group = recent.querySelector('.sidebar-recent-group'),
      heading = group.querySelector('h2');
    const available =
      sidebar.getBoundingClientRect().bottom -
      parseFloat(getComputedStyle(sidebar).paddingBottom) -
      settings.offsetHeight -
      recent.getBoundingClientRect().top -
      8;
    const overhead =
      heading.offsetHeight +
      parseFloat(getComputedStyle(heading).marginBottom) +
      parseFloat(getComputedStyle(group).marginBottom);
    const rowHeight = recent.querySelector('.sidebar-game-shortcut')?.offsetHeight || 42;
    return Math.max(1, Math.floor((available - overhead) / rowHeight));
  }
  function renderRecent(games = installedGames) {
    recentGames = games;
    const limit = recentLimit();
    for (const key of ['played']) {
      const rows = window.MambaActivity.sidebarRecent(games).slice(0, limit);
      groups[key].replaceChildren();
      if (!rows.length)
        groups[key].append(
          node(
            'p',
            key === 'played' ? 'No games played yet' : 'No recent installations',
            'sidebar-recent-empty',
          ),
        );
      for (const game of rows) {
        const row = node('div', undefined, 'sidebar-game-shortcut');
        const installed = game.status === 'installed' && !!game.executable;
        const thumb = button(
          '',
          () =>
            installed
              ? window.MambaExperience.play(game)
              : window.MambaExperience.openGame(game, 'library'),
          'play',
          'shortcut-thumbnail',
        );
        thumb.classList.remove('play-button');
        thumb.setAttribute('aria-label', (installed ? 'Play ' : 'View ') + game.name);
        thumb.title = (installed ? 'Play ' : 'View ') + game.name;
        thumb.prepend($('#library-empty svg').cloneNode(true));
        const showImage = (image) => {
          if (!image || !row.isConnected) return;
          const img = node('img');
          img.src = image;
          img.alt = '';
          img.decoding = 'async';
          img.onload = () => thumb.classList.add('has-artwork');
          img.onerror = () => img.remove();
          thumb.prepend(img);
        };
        const title = button(
          game.name,
          () => window.MambaExperience.openGame(game, 'library'),
          null,
          'shortcut-title',
        );
        title.title = game.name;
        if (game.running === true || game.status === 'running') {
          row.classList.add('is-running');
          title.append(node('small', 'Running'));
        }
        row.append(thumb, title);
        row.onclick = (event) => {
          if (!event.target.closest('button')) window.MambaExperience.openGame(game, 'library');
        };
        row.oncontextmenu = (event) => {
          event.preventDefault();
          showGameMenu(game, event.clientX, event.clientY, title);
        };
        row.onkeydown = (event) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault();
            const r = row.getBoundingClientRect();
            showGameMenu(game, r.right, r.top, title);
          }
        };
        groups[key].append(row);
        (game.cover ? Promise.resolve(game.cover) : window.MambaArtwork.get(game.id))
          .then(showImage)
          .catch(() => {});
      }
    }
  }
  window.addEventListener('resize', () => renderRecent(recentGames));
  new ResizeObserver(() => renderRecent(recentGames)).observe(sidebar);
  let gameMenu;
  function showGameMenu(game, x, y, restore) {
    gameMenu?.remove();
    const menu = node('div', undefined, 'game-context-menu');
    gameMenu = menu;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', game.name);
    const close = () => {
      menu.remove();
      if (gameMenu === menu) gameMenu = null;
      restore?.focus();
    };
    const add = (label, handler, symbol) => {
      const item = button(
        label,
        () => {
          close();
          return handler();
        },
        symbol,
        'context-menu-item',
      );
      item.setAttribute('role', 'menuitem');
      menu.append(item);
    };
    add('View details', () => window.MambaExperience.openGame(game, 'library'), 'info');
    if (game.status === 'installed' && game.executable)
      add('Play', () => window.MambaExperience.play(game), 'play');
    if (game.folder)
      add('Open folder', () => window.mamba.gameAction(game.id, 'folder'), 'folder-open');
    menu.onkeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        const items = [...menu.children];
        items[
          (items.indexOf(document.activeElement) +
            (event.key === 'ArrowDown' ? 1 : -1) +
            items.length) %
            items.length
        ].focus();
      }
      if (event.key === 'Tab') close();
    };
    document.body.append(menu);
    menu.style.left = Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8)) + 'px';
    menu.firstElementChild.focus();
  }
  document.addEventListener('pointerdown', (event) => {
    if (gameMenu && !gameMenu.contains(event.target)) {
      gameMenu.remove();
      gameMenu = null;
    }
  });
  $('#game-list').addEventListener('contextmenu', (event) => {
    const card = event.target.closest('[data-game-id]');
    const game = installedGames.find((g) => g.id === card?.dataset.gameId);
    if (game) {
      event.preventDefault();
      showGameMenu(game, event.clientX, event.clientY, card.querySelector('button'));
    }
  });
  window.MambaDesktop = {
    configure: (c) => {
      document.documentElement.dataset.sidebarCollapsed = 'false';
      renderRecent();
      updateConnections(c);
    },
    renderRecent,
    updateConnections,
  };
  const serviceStatuses = [];
  for (const row of document.querySelectorAll('.service-switch')) {
    const title = row.querySelector('strong')?.textContent;
    if (!['TorBox', 'Real-Debrid'].includes(title)) continue;
    const status = node('small', undefined, 'service-credential-status');
    status.setAttribute('role', 'status');
    row.querySelector('span').append(status);
    serviceStatuses.push([title, status]);
  }
  function updateConnections(c) {
    for (const [title, status] of serviceStatuses)
      status.textContent = (title === 'TorBox' ? c.configured : c.realDebridConfigured)
        ? 'Credential saved'
        : 'No credential saved';
  }

  const field = $('#extra-game-folders');
  function folders() {
    return [
      ...new Set(
        field.value
          .split('\n')
          .map((p) => p.trim())
          .filter(Boolean),
      ),
    ];
  }
  function saveFolders(values) {
    field.value = values.join('\n');
    renderFolders();
    scheduleSettingsSave(150);
  }
  function renderFolders() {
    const list = $('#folder-list');
    list.replaceChildren();
    const values = folders();
    if (!values.length) list.append(node('p', 'No extra folders added.', 'field-hint'));
    values.forEach((folder, index) => {
      const row = node('div', undefined, 'folder-row');
      const copy = node('span', folder, 'folder-path');
      copy.title = folder;
      const change = button(
        'Change',
        async () => {
          try {
            const chosen = await window.mamba.chooseFolder();
            if (chosen) saveFolders(folders().map((p) => (p === folder ? chosen : p)));
          } catch (e) {
            window.MambaExperience.handleError(e);
          }
        },
        'folder-open',
        'secondary-button',
      );
      change.setAttribute('aria-label', 'Change folder ' + folder);
      const remove = button(
        'Remove',
        () => {
          saveFolders(folders().filter((p) => p !== folder));
          const controls = list.querySelectorAll('button');
          (controls[Math.min(index * 2, controls.length - 1)] || $('#browse-extra-folder')).focus();
        },
        'trash-2',
        'text-button',
      );
      remove.setAttribute('aria-label', 'Remove folder ' + folder);
      row.append(copy, change, remove);
      list.append(row);
    });
  }
  window.MambaFolders = { render: renderFolders };
  renderFolders();

  // Group the existing controls without changing their identifiers or save handlers.
  const installation = $('#install-title').closest('.settings-card');
  const storage = node('section', undefined, 'settings-group storage-group');
  const mainLabel = $('label[for="download-path"]');
  const pathField = $('.path-field');
  const pathHint = pathField.nextElementSibling;
  pathHint.textContent = 'New downloads and installations are saved here.';
  storage.append(
    mainLabel,
    pathField,
    pathHint,
    $('#folder-list-label'),
    field,
    $('#folder-list'),
    $('#browse-extra-folder'),
    $('#extra-folders-hint'),
  );
  installation.querySelector('.settings-card-heading').after(storage);
  const advanced = node('details', undefined, 'settings-advanced');
  advanced.append(node('summary', 'Advanced download options'));
  for (const id of [
    'automatic-recovery',
    'archive-password',
    'keep-archives',
    'transfer-timeout',
  ]) {
    const input = $('#' + id);
    if (input.type === 'checkbox') advanced.append(input.closest('.switch-row'));
    else advanced.append($('label[for="' + id + '"]'), input);
  }
  installation.append(advanced);
  const rd = $('#realdebrid-status');
  if (rd) rd.setAttribute('role', 'status');
  if (configLoaded) configReady.then((c) => window.MambaDesktop.configure(c));
  else renderRecent();
})();

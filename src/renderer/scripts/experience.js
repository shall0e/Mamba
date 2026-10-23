(() => {
  const $ = (selector) => document.querySelector(selector);
  let currentDetail = null,
    generation = 0,
    availability = 'all',
    sort = 'name',
    activity = null;
  let recentJobs = [],
    openIssues = 0,
    currentPage = 'search';
  let speedHistory = [];
  let discoveryJobsSignature = '';
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  function handleError(error) {
    const text = String(error?.message || error || 'This task could not finish.').replace(
      /^Error invoking remote method '[^']+': (?:Error: )?/,
      '',
    );
    if (/background service (?:stopped|is unavailable)/i.test(text)) return true;
    showToast(text + ' · See Activity for help');
    window.mamba.reportIssue(text).catch(() => {});
    return true;
  }
  function action(label, callback, iconName, className) {
    return button(label, callback, iconName, className);
  }
  function cover(container, id, name) {
    container.append($('#library-empty svg').cloneNode(true));
    window.mamba
      .artwork(id)
      .then((image) => {
        if (!image || !container.isConnected) return;
        const img = node('img');
        img.src = image;
        img.alt = name + ' artwork';
        img.decoding = 'async';
        img.loading = 'lazy';
        img.onload = () => container.classList.add('has-cover');
        img.onerror = () => img.remove();
        container.append(img);
      })
      .catch(() => {});
  }
  function date(value) {
    return value
      ? new Date(value).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : 'Not played yet';
  }
  async function refreshLibrary() {
    renderLibrary(await window.mamba.library());
  }
  async function toggleFavorite(game) {
    await window.mamba.favorite(game.id, !game.favorite);
  }
  async function playGame(game) {
    await window.mamba.gameAction(game.id, 'play');
    await refreshLibrary();
  }
  function renderLibrary(games) {
    installedGames = Array.isArray(games)
      ? games.filter((game) => game && typeof game.name === 'string')
      : [];
    const query = $('#library-filter').value.trim().toLowerCase();
    const matches = installedGames.filter(
      (game) =>
        (availability === 'all' ||
          (availability === 'installed'
            ? !['not-installed', 'drive-unavailable'].includes(game.status)
            : ['not-installed', 'drive-unavailable'].includes(game.status))) &&
        [
          game.name,
          ...(game.installations || []).map((item) => item.sourceName || item.name),
          ...(game.dlcs || []).map((item) => item.name),
        ]
          .join(' ')
          .toLowerCase()
          .includes(query),
    );
    matches.sort((a, b) => window.MambaPresence.compareLibrary(a, b, sort));
    $('#library-empty').hidden = installedGames.length > 0;
    $('#library-toolbar').hidden = !installedGames.length;
    $('#filter-empty').hidden = matches.length > 0 || !installedGames.length;
    $('#game-count').textContent =
      installedGames.length + ' ' + (installedGames.length === 1 ? 'game' : 'games');
    const list = $('#game-list');
    list.replaceChildren();
    for (const game of matches) {
      const card = node('li', undefined, 'game-card');
      card.dataset.status = game.status;
      const image = action(
        '',
        async () => {
          if (game.imported && ['not-installed', 'drive-unavailable'].includes(game.status)) {
            if (await window.mamba.locateGame(game.id)) await refreshLibrary();
          } else await openGame(game, 'library');
        },
        null,
        'game-art library-cover',
      );
      image.setAttribute('aria-label', 'View ' + game.name);
      cover(image, game.id, game.name);
      const favorite = action(
        '',
        () => toggleFavorite(game),
        'star',
        'favorite-button' + (game.favorite ? ' is-favorite' : ''),
      );
      favorite.setAttribute(
        'aria-label',
        (game.favorite ? 'Unfavorite ' : 'Favorite ') + game.name,
      );
      favorite.setAttribute('aria-pressed', String(!!game.favorite));
      favorite.title = favorite.getAttribute('aria-label');
      const heading = node('h2');
      const title = action(game.name, () => openGame(game, 'library'), null, 'library-game-title');
      title.title = game.name;
      heading.append(title);
      const controls = node('div', undefined, 'game-actions');
      if (game.status === 'installed' && game.executable)
        controls.append(action('Play', () => playGame(game), 'play', 'primary-button'));
      else
        controls.append(
          action(
            ['not-installed', 'drive-unavailable'].includes(game.status)
              ? game.imported && !game.releaseId
                ? 'Locate files'
                : 'Install'
              : 'Review',
            async () => {
              if (
                game.imported &&
                !game.releaseId &&
                ['not-installed', 'drive-unavailable'].includes(game.status)
              ) {
                if (await window.mamba.locateGame(game.id)) await refreshLibrary();
              } else await openGame(game, 'library');
            },
            ['not-installed', 'drive-unavailable'].includes(game.status)
              ? 'download'
              : 'settings-2',
            'primary-button',
          ),
        );
      const info = node('div', undefined, 'library-card-info');
      info.append(heading, controls);
      card.append(image, favorite, info);
      if (game.status !== 'installed' || game.repairPending)
        card.append(
          node(
            'p',
            game.repairPending
              ? 'Folder cleanup pending'
              : game.status === 'base-missing'
                ? 'Base game required'
                : game.status === 'not-installed'
                  ? 'Not installed'
                  : game.status === 'drive-unavailable'
                    ? 'Drive unavailable'
                    : 'Setup required',
            'game-secondary',
          ),
        );
      list.append(card);
    }
    renderRecentGames();
    window.MambaDiscovery?.render();
  }
  function renderRecentGames() {
    const list = $('#recently-played');
    list.replaceChildren();
    const games = window.MambaActivity.recent(installedGames);
    for (const game of games) {
      const row = node('article', undefined, 'recent-game');
      const image = action('', () => openGame(game, 'library'), null, 'game-art recent-art');
      image.setAttribute('aria-label', 'View ' + game.name);
      cover(image, game.id, game.name);
      const info = node('div', undefined, 'recent-game-info');
      info.append(node('h3', game.name), node('p', date(game.lastPlayed), 'field-hint'));
      const play = action('', () => playGame(game), 'play', 'recent-play');
      play.setAttribute('aria-label', 'Play ' + game.name);
      play.title = 'Play ' + game.name;
      row.append(image, info, play);
      list.append(row);
    }
    if (!games.length) {
      const empty = node('div', undefined, 'recent-empty');
      empty.append(
        node('p', 'No play history yet.', 'field-hint'),
        action('Open library', () => showPage('library'), 'arrow-right'),
      );
      list.append(empty);
    }
  }
  function renderDownloadOverview() {
    const summary = window.MambaActivity.summary(recentJobs);
    const value = $('#current-speed');
    value.replaceChildren(
      document.createTextNode((summary.speed / 1000000).toFixed(1) + ' '),
      node('span', 'MB/s'),
    );
    $('#speed-state').textContent = summary.count
      ? summary.count + ' downloading'
      : recentJobs.some((job) => job.status === 'paused')
        ? 'Paused'
        : 'Idle';
    $('#download-remaining').textContent =
      summary.count && !summary.unknownSize ? formatBytes(summary.remaining) + ' left' : '';
    const chart = $('#speed-chart');
    chart.replaceChildren();
    const now = Date.now();
    const points = speedHistory.filter((point) => point.at > now - 60000);
    if (points.length < 2) {
      chart.append(
        node(
          'p',
          summary.count ? 'Collecting download speed…' : 'No active downloads',
          'chart-empty',
        ),
      );
      return;
    }
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 600 120');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Download speed over the last 60 seconds');
    const max = Math.max(1000000, ...points.map((point) => point.speed)) * 1.15;
    for (const y of [20, 60, 100]) {
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', '0');
      line.setAttribute('x2', '600');
      line.setAttribute('y1', y);
      line.setAttribute('y2', y);
      line.setAttribute('class', 'chart-grid');
      svg.append(line);
    }
    const coords = points.map((point) => [
      Math.max(0, 600 - (now - point.at) / 100),
      110 - (point.speed / max) * 100,
    ]);
    const d = coords
      .map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1))
      .join(' ');
    const area = document.createElementNS(ns, 'path');
    area.setAttribute('d', d + ' L' + coords.at(-1)[0] + ',120 L' + coords[0][0] + ',120 Z');
    area.setAttribute('class', 'chart-area');
    const line = document.createElementNS(ns, 'path');
    line.setAttribute('d', d);
    line.setAttribute('class', 'chart-line');
    svg.append(area, line);
    chart.append(svg);
  }
  function mountDownloadOptions(section, resolved, data) {
    const names = { torbox: 'TorBox', realdebrid: 'Real-Debrid', direct: 'Direct download' };
    const filters = node('div', undefined, 'download-filters');
    const list = node('div', undefined, 'version-list');
    const select = (label, values) => {
      const control = node('select', undefined, 'discovery-select');
      control.setAttribute('aria-label', label);
      for (const [value, text] of values) {
        const option = node('option', text);
        option.value = value;
        control.append(option);
      }
      return control;
    };
    const methods = [
      ...new Set(resolved.options.flatMap((option) => option.services || ['torbox'])),
    ];
    const service = select('Filter versions by service', [
      ['all', 'All services'],
      ...methods.map((id) => [id, names[id]]),
    ]);
    const sources = [...new Set(resolved.options.flatMap((option) => option.sources))];
    const source = select('Filter versions by source', [
      ['all', 'All sources'],
      ...sources.map((name) => [name, name]),
    ]);
    const query = node('input', undefined, 'version-search');
    query.type = 'search';
    query.placeholder = 'Filter versions';
    query.setAttribute('aria-label', 'Filter versions');
    filters.append(service, source, query);
    section.append(filters, list);
    let limit = 6;
    const draw = () => {
      list.replaceChildren();
      const options = [...resolved.options]
        .sort(
          (a, b) =>
            Number(b.gameId === data.preferredReleaseId) -
            Number(a.gameId === data.preferredReleaseId),
        )
        .filter(
          (option) =>
            (service.value === 'all' || (option.services || ['torbox']).includes(service.value)) &&
            (source.value === 'all' || option.sources.includes(source.value)) &&
            option.release.toLowerCase().includes(query.value.trim().toLowerCase()),
        );
      for (const option of options.slice(0, limit)) {
        const best =
          resolved.best?.gameId === option.gameId && resolved.best?.linkIndex === option.linkIndex;
        const card = node('article', undefined, 'version-card' + (best ? ' best-version' : ''));
        const info = node('div', undefined, 'version-info');
        const title = node('h3', option.release);
        info.append(title);
        const meta = node(
          'p',
          [option.fileSize, option.host || 'Torrent', ...option.sources]
            .filter(Boolean)
            .join(' · '),
          'choice-meta',
        );
        info.append(meta);
        const tags = node('div', undefined, 'version-tags');
        if (option.gameId === data.preferredReleaseId)
          tags.append(node('span', 'Previously installed'));
        else if (best) tags.append(node('span', 'Recommended'));
        if (option.traits.portable) tags.append(node('span', 'Portable'));
        if (option.traits.version) tags.append(node('span', 'v' + option.traits.version));
        if (option.traits.english) tags.append(node('span', 'English / multilingual'));
        if (!option.available || option.traits.incompatible || option.traits.partial)
          tags.append(
            node(
              'span',
              option.traits.incompatible
                ? 'Not for Windows'
                : option.traits.partial
                  ? 'Update / add-on'
                  : 'Unavailable',
            ),
          );
        info.append(tags);
        const controls = node('div', undefined, 'version-controls');
        const services = option.services || ['torbox'];
        const method = select(
          'Download ' + option.release + ' using',
          services.map((id) => [id, names[id] || id]),
        );
        const preferred = downloadPreferences.preferredDownloadService;
        if (services.includes(preferred)) method.value = preferred;
        if (service.value !== 'all') method.value = service.value;
        if (services.length > 1) controls.append(method);
        else controls.append(node('span', names[services[0]] || 'No service', 'version-service'));
        const existing = recentJobs.find(
          (job) =>
            job.gameId === option.gameId &&
            !['completed', 'cancelled', 'needs-setup'].includes(job.status),
        );
        const download = action(
          existing && ['paused', 'failed'].includes(existing.status)
            ? existing.status === 'paused'
              ? 'Resume'
              : 'Retry'
            : existing
              ? 'View download'
              : 'Download',
          async () => {
            if (existing) {
              if (['paused', 'failed'].includes(existing.status))
                await window.mamba.retry(existing.id);
              showPage('activity');
              return;
            }
            const started = await window.mamba.download(
              option.gameId,
              option.linkIndex,
              data.catalogId,
              method.value,
              data.libraryId,
            );
            if (started === false) return;
            showToast('Added to downloads');
            showPage('activity');
          },
          'download',
          best ? 'primary-button' : 'secondary-button',
        );
        download.disabled =
          !option.available || option.traits.incompatible || option.traits.partial;
        controls.append(download);
        card.append(info, controls);
        list.append(card);
      }
      if (!options.length) list.append(node('p', 'No versions match these filters.', 'field-hint'));
      if (options.length > limit)
        list.append(
          action(
            'Show more versions (' + (options.length - limit) + ')',
            () => {
              limit += 12;
              draw();
            },
            'chevron-down',
            'text-button more-versions',
          ),
        );
    };
    for (const control of [service, source])
      control.onchange = () => {
        limit = 6;
        draw();
      };
    query.oninput = () => {
      limit = 6;
      draw();
    };
    draw();
  }
  async function openGame(game, origin) {
    const token = ++generation;
    currentDetail = null;
    const detailPage = $('#game-page');
    detailPage.classList.remove('has-game-backdrop');
    detailPage.style.removeProperty('--game-backdrop-image');
    window.MambaExperience.origin = origin || (!$('#library-page').hidden ? 'library' : 'search');
    const returnPage = window.MambaExperience.origin === 'library' ? 'library' : 'search';
    const returnScroll = $('#' + returnPage + '-page').scrollTop;
    const content = $('#game-content');
    content.replaceChildren();
    content.append(
      action(
        'Back to ' + (returnPage === 'search' ? 'Home' : 'Library'),
        () => {
          generation++;
          showPage(returnPage);
          $('#' + returnPage + '-page').scrollTop = returnScroll;
        },
        'arrow-left',
      ),
    );
    const title = node('h1', game.name || 'Game details');
    title.id = 'game-title';
    title.tabIndex = -1;
    content.append(title);
    const loading = node('p', 'Loading game details…', 'field-hint');
    loading.setAttribute('role', 'status');
    content.append(loading);
    showPage('game');
    try {
      const data = await window.mamba.details(game.id);
      if (token !== generation) return;
      currentDetail = data;
      loading.remove();
      title.remove();
      window.mamba
        .artwork(data.libraryId || data.catalogId || data.id)
        .then((image) => {
          if (!image || token !== generation) return;
          detailPage.style.setProperty('--game-backdrop-image', `url("${image}")`);
          detailPage.classList.add('has-game-backdrop');
        })
        .catch(() => {});
      const hero = node('div', undefined, 'detail-hero');
      const image = node('div', undefined, 'detail-art game-art');
      cover(image, data.libraryId || data.catalogId || data.id, data.name);
      const intro = node('div', undefined, 'detail-intro');
      const heading = node('h1', data.name);
      heading.id = 'game-title';
      heading.tabIndex = -1;
      intro.append(node('p', data.steamId ? 'STEAM GAME' : 'YOUR GAME', 'page-eyebrow'), heading);
      intro.append(
        node(
          'p',
          [data.developers.join(', '), data.releaseDate, ...data.genres]
            .filter(Boolean)
            .join(' · '),
          'page-description',
        ),
      );
      const primary = node('div', undefined, 'detail-primary');
      const local = window.MambaPresence.installed(installedGames, data);
      const playable =
        data.installations.find((item) => item.status === 'installed' && item.executable) ||
        (local?.status === 'installed' && local.executable ? local : null);
      const removeInstallation = async (installation) => {
        const result = await window.mamba.removeGame(installation.id);
        if (!result) return;
        await refreshLibrary();
        showPage('library');
        showToast('Game uninstalled; kept in library');
      };
      if (data.libraryId)
        intro.append(
          node(
            'span',
            playable
              ? 'Installed on this PC'
              : data.status === 'not-installed'
                ? 'Not installed'
                : data.status === 'drive-unavailable'
                  ? 'Drive unavailable'
                  : 'Setup required',
            'detail-owned',
          ),
        );
      if (playable)
        primary.append(
          action(
            'Play',
            () => window.mamba.gameAction(playable.id, 'play'),
            'play',
            'primary-button',
          ),
        );
      const existingDownload = window.MambaPresence.download(recentJobs, { ...game, ...data });
      if (existingDownload && !['completed', 'cancelled'].includes(existingDownload.status))
        primary.append(
          action(
            ['paused', 'failed'].includes(existingDownload.status)
              ? 'Resume download'
              : 'View download',
            async () => {
              if (['paused', 'failed'].includes(existingDownload.status))
                await window.mamba.retry(existingDownload.id);
              showPage('activity');
            },
            'download',
            'secondary-button',
          ),
        );
      else if (data.catalogId)
        primary.append(
          action(
            playable ? 'Other versions' : 'Install',
            () => {
              const options = $('#game-downloads');
              if (options?.tagName === 'DETAILS') options.open = true;
              options?.scrollIntoView({
                behavior: reducedBackdropMotion.matches ? 'instant' : 'smooth',
                block: 'start',
              });
            },
            'download',
            playable ? 'secondary-button' : 'primary-button',
          ),
        );
      if (data.libraryId) {
        const favorite = action(
          data.favorite ? 'Favorited' : 'Favorite',
          async () => {
            await window.mamba.favorite(data.libraryId, !data.favorite);
            data.favorite = !data.favorite;
            favorite.lastChild.textContent = data.favorite ? 'Favorited' : 'Favorite';
            favorite.setAttribute('aria-pressed', String(data.favorite));
          },
          'star',
        );
        favorite.setAttribute('aria-pressed', String(data.favorite));
        primary.append(favorite);
      }
      if (!data.libraryId && data.catalogId)
        primary.append(
          action(
            'Add to library',
            async () => {
              await window.mamba.addLibraryEntry(data.catalogId);
              await refreshLibrary();
              await openGame(
                { id: data.catalogId, name: data.name },
                window.MambaExperience.origin,
              );
              showToast('Added to library');
            },
            'plus',
          ),
        );
      if (data.libraryId && !data.catalogId && !playable)
        intro.append(
          node(
            'p',
            'No matching download is currently available. Locate your existing files or refresh your sources.',
            'field-hint',
          ),
        );
      const installationToRemove =
        playable ||
        data.installations.find(
          (item) =>
            item.folderExists || !['not-installed', 'drive-unavailable'].includes(item.status),
        );
      if (installationToRemove)
        primary.append(
          action(
            'Uninstall',
            () => removeInstallation(installationToRemove),
            'trash-2',
            'text-button danger-action',
          ),
        );
      if (data.libraryId) {
        if (!playable)
          primary.append(
            action(
              'Locate files',
              async () => {
                if (await window.mamba.locateGame(data.libraryId)) {
                  await refreshLibrary();
                  showPage('library');
                  showToast('Installation located');
                }
              },
              'folder-open',
            ),
          );
        primary.append(
          action(
            'Remove from library',
            async () => {
              if (await window.mamba.removeLibraryEntry(data.libraryId)) {
                await refreshLibrary();
                showPage('library');
                showToast('Removed from library; files kept');
              }
            },
            'trash-2',
            'text-button danger-action',
          ),
        );
      }
      intro.append(primary);
      if (data.lastPlayed)
        intro.append(node('p', 'Last played ' + date(data.lastPlayed), 'field-hint'));
      hero.append(image, intro);
      content.append(hero);
      if (data.description) content.append(node('p', data.description, 'game-description'));
      const presentInstallations = data.installations.filter(
        (item) =>
          item.folderExists || !['not-installed', 'drive-unavailable'].includes(item.status),
      );
      if (presentInstallations.length) {
        const section = node('section', undefined, 'detail-section');
        section.append(node('h2', 'Installed versions'));
        for (const installation of presentInstallations) {
          const card = node('article', undefined, 'installation-card');
          card.append(
            node(
              'h3',
              installation.version
                ? 'Version ' + installation.version
                : installation.sourceName || data.name,
            ),
          );
          card.append(
            node(
              'p',
              installation.status === 'installed'
                ? 'Ready to play'
                : 'Setup or launcher review required',
              'installation-status',
            ),
          );
          const details = node('dl', undefined, 'installation-fields');
          for (const [label, value] of [
            ['Game folder', installation.folder],
            ['Startup file', installation.executable || 'No launcher selected'],
            ['Installed version', installation.version || 'Not reported by this release'],
            [
              'Added',
              installation.installedAt ? date(installation.installedAt) : 'Existing installation',
            ],
          ])
            details.append(node('dt', label), node('dd', value));
          const manage = node('details', undefined, 'manage-installation');
          manage.append(node('summary', 'Manage installation'), details);
          const controls = node('div', undefined, 'game-actions');
          if (installation.status === 'installed' && installation.executable)
            controls.append(
              action(
                'Play',
                () => window.mamba.gameAction(installation.id, 'play'),
                'play',
                'primary-button',
              ),
            );
          if (installation.installer)
            controls.append(
              action('Run setup', () => window.mamba.gameAction(installation.id, 'setup'), 'play'),
              action(
                'Run setup as administrator',
                async () => {
                  if (await window.mamba.gameAction(installation.id, 'setup-admin'))
                    showToast('Setup started as administrator');
                },
                'play',
              ),
            );
          controls.append(
            action(
              'Change launcher',
              async () => {
                const result = await window.mamba.chooseLauncher(installation.id);
                if (result) {
                  await refreshLibrary();
                  await openGame({ id: data.libraryId || data.id, name: data.name }, 'library');
                  showToast('Startup file saved');
                }
              },
              'folder-open',
            ),
          );
          controls.append(
            action(
              'Open folder',
              () => window.mamba.gameAction(installation.id, 'folder'),
              'folder-open',
            ),
          );
          controls.append(
            action(
              'Setup helper',
              () => window.mamba.gameAction(installation.id, 'launcher'),
              'settings-2',
            ),
          );
          card.append(
            action(
              'Uninstall',
              () => removeInstallation(installation),
              'trash-2',
              'text-button danger-action',
            ),
          );
          const launchEditor = node('div', undefined, 'launch-options-editor');
          launchEditor.append(node('h3', 'Launch options'));
          const launchArguments = node('input');
          launchArguments.type = 'text';
          launchArguments.maxLength = 4096;
          launchArguments.placeholder = '-windowed -width 1920';
          launchArguments.value = installation.launchOptions?.arguments || '';
          const argumentsLabel = node('label', 'Arguments');
          argumentsLabel.append(launchArguments);
          const workingDirectory = node('input');
          workingDirectory.type = 'text';
          workingDirectory.maxLength = 2048;
          workingDirectory.placeholder = 'Default: startup file folder';
          workingDirectory.value = installation.launchOptions?.workingDirectory || '';
          const directoryLabel = node('label', 'Working directory');
          directoryLabel.append(workingDirectory);
          const saveLaunch = action(
            'Save launch options',
            async () => {
              saveLaunch.disabled = true;
              try {
                installation.launchOptions = await window.mamba.saveLaunchOptions(installation.id, {
                  arguments: launchArguments.value,
                  workingDirectory: workingDirectory.value,
                });
                await refreshLibrary();
                showToast('Launch options saved');
              } finally {
                saveLaunch.disabled = false;
              }
            },
            'check',
            'primary-button',
          );
          const launchActions = node('div', undefined, 'game-actions');
          launchActions.append(
            saveLaunch,
            action(
              'Clear',
              () => {
                launchArguments.value = '';
                workingDirectory.value = '';
              },
              'rotate-ccw',
            ),
          );
          launchEditor.append(
            argumentsLabel,
            directoryLabel,
            node(
              'p',
              'Use quotes around arguments containing spaces. Working directories are relative to the game folder. Leave blank for defaults. Saved options are applied when you next launch from Mamba.',
              'field-hint',
            ),
            launchActions,
          );
          const integrations = node('div', undefined, 'launch-options-editor');
          integrations.append(node('h3', 'Integrations'));
          const reinstallIntegrations = action(
            'Reinstall integrations',
            async () => {
              reinstallIntegrations.disabled = true;
              reinstallIntegrations.setAttribute('aria-busy', 'true');
              try {
                await window.mamba.reinstallIntegrations(installation.id);
                showToast('Integrations reinstalled');
              } finally {
                reinstallIntegrations.disabled = false;
                reinstallIntegrations.removeAttribute('aria-busy');
              }
            },
            'refresh-cw',
            'secondary-button',
          );
          integrations.append(
            node(
              'p',
              'Reinstall integration files for this installation. Original Steam API DLLs are saved with an _o suffix; existing backups are kept.',
              'field-hint',
            ),
            reinstallIntegrations,
          );
          manage.append(controls, launchEditor, integrations);
          card.append(manage);
          section.append(card);
        }
        content.append(section);
      }
      if (data.dlcs.length || data.demos.length || data.availableDlcCount) {
        const section = node('section', undefined, 'detail-section');
        section.append(node('h2', 'Additional content'));
        for (const item of [...data.dlcs, ...data.demos]) {
          const row = node('div', undefined, 'content-item');
          row.append(
            node('p', item.name),
            action('Open folder', () => window.mamba.gameAction(item.id, 'folder'), 'folder-open'),
          );
          section.append(row);
        }
        section.append(
          node(
            'p',
            data.dlcs.length +
              ' installed DLC folders detected' +
              (data.availableDlcCount
                ? ' · ' + data.availableDlcCount + ' DLC listed by Steam'
                : ''),
            'field-hint',
          ),
        );
        content.append(section);
      }
      if (data.catalogId) {
        const section = node(
          playable ? 'details' : 'section',
          undefined,
          'detail-section game-downloads',
        );
        section.id = 'game-downloads';
        section.append(
          node(playable ? 'summary' : 'h2', playable ? 'Other downloads' : 'Downloads'),
        );
        const hint = node('p', 'Checking your enabled download services…', 'field-hint');
        section.append(hint);
        content.append(section);
        if (data.space) {
          const info = node(
            'p',
            data.space.error ||
              [
                data.space.free === null
                  ? 'Free space unavailable'
                  : formatBytes(data.space.free) + ' free',
                data.space.required
                  ? formatBytes(data.space.required) + ' estimated for download and setup'
                  : 'Size will be checked when TorBox prepares the files',
              ].join(' · '),
            'storage-note',
          );
          section.append(info);
        }
        try {
          const resolved = await window.mamba.resolveGame(data.catalogId);
          if (token !== generation) return;
          hint.remove();
          mountDownloadOptions(section, resolved, data);
        } catch (error) {
          hint.textContent =
            'Download options could not be checked. ' +
            String(error.message).replace(
              /^Error invoking remote method '[^']+': (?:Error: )?/,
              '',
            );
          section.append(
            action(
              'Try again',
              () => openGame({ id: data.id, name: data.name }, window.MambaExperience.origin),
              'refresh-cw',
            ),
            action('Open settings', openSettings, 'settings-2'),
          );
        }
      }
    } catch (error) {
      if (token !== generation) return;
      loading.textContent = 'Game details could not be loaded.';
      content.append(
        node('p', String(error.message), 'field-hint'),
        action('Try again', () => openGame(game, window.MambaExperience.origin), 'refresh-cw'),
        action('Troubleshoot', () => showPage('activity'), 'circle-alert'),
      );
    }
  }
  function renderIssues(items = []) {
    const open = items.filter((issue) => !issue.resolved);
    openIssues = open.length;
    updateActivityBadge();
    $('#issue-count').textContent = open.length + ' open';
    const list = $('#issues-list');
    list.replaceChildren();
    $('.issues-section').hidden = !open.length;
    if (!open.length) list.append(node('p', 'No unresolved issues.', 'field-hint'));
    for (const issue of open) {
      const card = node('article', undefined, 'issue-card');
      const heading = node('h3');
      heading.append(
        icon('circle-alert'),
        document.createTextNode(issue.title || 'This task needs attention'),
      );
      card.append(heading, node('p', issue.advice || 'Try again.', 'issue-advice'));
      const detail = node('details', undefined, 'issue-details');
      detail.append(
        node('summary', 'Details'),
        node('p', issue.message),
        node(
          'p',
          date(issue.at) + (issue.count > 1 ? ' · Seen ' + issue.count + ' times' : ''),
          'field-hint',
        ),
      );
      card.append(detail);
      const controls = node('div', undefined, 'game-actions');
      if (issue.code === 'permissions' && /\.(exe|msi)\b/i.test(issue.message))
        controls.append(
          action(
            'Retry setup as administrator',
            async () => {
              if (await window.mamba.retrySetupAsAdmin(issue.id))
                showToast('Setup started as administrator');
            },
            'refresh-cw',
          ),
        );
      if (issue.action === 'settings')
        controls.append(action('Open settings', openSettings, 'settings-2'));
      if (issue.action === 'library')
        controls.append(action('Review library', () => showPage('library'), 'folder-open'));
      if (['catalog:sync', 'catalog:search'].includes(issue.context))
        controls.append(action('Retry source sync', () => window.mamba.sync(), 'refresh-cw'));
      if (issue.context === 'library:scan')
        controls.append(action('Refresh library', refreshLibrary, 'refresh-cw'));
      controls.append(action('Mark resolved', () => window.mamba.resolveIssue(issue.id), 'check'));
      card.append(controls);
      list.append(card);
    }
  }
  async function loadActivity() {
    try {
      activity = await window.mamba.activity();
      const health = $('#system-health');
      health.replaceChildren();
      for (const [title, value, hint] of [
        [
          'Background tasks',
          activity.worker.connected ? 'Connected' : 'Disconnected',
          activity.worker.pending + ' requests in progress',
        ],
        [
          'Sources',
          activity.catalog.phase,
          activity.catalog.count.toLocaleString() +
            ' checked releases · ' +
            activity.catalog.unavailableSources +
            ' sources unavailable',
        ],
        ['Library', activity.libraryCount + ' games', 'Installed games on this PC'],
      ]) {
        const card = node('article', undefined, 'health-card');
        card.append(
          node('p', title, 'field-hint'),
          node('h2', value),
          node('p', hint, 'field-hint'),
        );
        health.append(card);
      }
      $('#stop-sync').disabled = !['fetching', 'merging', 'checking', 'waiting'].includes(
        activity.catalog.phase,
      );
      $('#restart-tasks').disabled = activity.jobs.some((job) =>
        ['verifying', 'extracting', 'installing'].includes(job.status),
      );
      renderIssues(activity.issues);
      renderDownloadOverview();
    } catch (error) {
      $('#system-health').replaceChildren(
        node('p', 'Status is unavailable. ' + error.message, 'field-hint'),
      );
    }
  }
  function updateActivityBadge() {
    const active = recentJobs.filter(
      (job) => !['completed', 'cancelled', 'needs-setup', 'failed', 'paused'].includes(job.status),
    ).length;
    const count = active + openIssues;
    $('#activity-count').hidden = !count;
    $('#activity-count').textContent = count;
    $('#activity-count').title = active + ' active downloads · ' + openIssues + ' issues';
    $('#activity-count').setAttribute('aria-label', count + ' tasks or issues');
  }
  function jobsChanged(jobs) {
    recentJobs = jobs;
    const count = jobs.filter(
      (job) => !['completed', 'cancelled', 'needs-setup', 'failed', 'paused'].includes(job.status),
    ).length;
    updateActivityBadge();
    $('#activity-empty').hidden = jobs.length > 0;
    speedHistory = window.MambaActivity.sample(speedHistory, jobs);
    renderDownloadOverview();
    const signature = jobs.map((job) => job.id + ':' + job.status).join('|');
    if (signature !== discoveryJobsSignature) {
      discoveryJobsSignature = signature;
      if (!$('#search-results').hidden) window.MambaDiscovery?.render();
    }
  }
  function pageChanged(name) {
    currentPage = name;
    if (name === 'activity') {
      loadActivity();
      renderDownloadOverview();
      renderRecentGames();
    }
  }
  const api = {
    origin: 'search',
    openGame,
    renderLibrary,
    jobsChanged,
    pageChanged,
    handleError,
    play: playGame,
    get jobs() {
      return recentJobs;
    },
    configure(config) {
      sort = config.librarySort || 'name';
      availability = config.libraryAvailability || 'all';
      $('#library-availability').value = availability;
      $('#library-sort').value = sort;
      renderLibrary(installedGames);
    },
  };
  window.MambaExperience = api;
  $('#activity-transfers').append($('#transfers'));
  const activityTools = node('details', undefined, 'activity-tools');
  $('.activity-controls').append($('#export-diagnostics'));
  activityTools.append(
    node('summary', 'More tools'),
    $('#system-health'),
    $('.activity-controls'),
    $('#storage-status'),
  );
  $('#activity-page').append(activityTools);
  const toolbar = $('#library-toolbar');
  const filters = node('div', undefined, 'library-view-controls');
  const availabilitySelect = node('select', undefined, 'settings-input library-sort');
  availabilitySelect.id = 'library-availability';
  availabilitySelect.setAttribute('aria-label', 'Filter library by installation');
  for (const [value, label] of [
    ['all', 'All games'],
    ['installed', 'Installed'],
    ['not-installed', 'Not installed'],
  ]) {
    const option = node('option', label);
    option.value = value;
    availabilitySelect.append(option);
  }
  availabilitySelect.onchange = () => {
    availability = availabilitySelect.value;
    renderLibrary(installedGames);
    window.mamba.saveView({ libraryAvailability: availability }).catch(handleError);
  };
  const sortSelect = node('select', undefined, 'settings-input library-sort');
  sortSelect.id = 'library-sort';
  sortSelect.setAttribute('aria-label', 'Sort library');
  for (const [value, label] of [
    ['name', 'Name A–Z'],
    ['recent', 'Recently played'],
    ['installed', 'Recently installed'],
  ]) {
    const option = node('option', label);
    option.value = value;
    sortSelect.append(option);
  }
  sortSelect.onchange = () => {
    sort = sortSelect.value;
    renderLibrary(installedGames);
    window.mamba.saveView({ librarySort: sort }).catch(handleError);
  };
  filters.append(availabilitySelect, sortSelect);
  toolbar.append(filters);
  const bind = (id, callback, iconName) => {
    const element = $(id);
    if (iconName) element.prepend(icon(iconName));
    element.addEventListener('click', async () => {
      element.disabled = true;
      try {
        await callback();
      } catch (error) {
        handleError(error);
      } finally {
        element.disabled = false;
      }
    });
  };
  bind('#activity-open', () => showPage('activity'));
  bind('#open-troubleshooting', () => showPage('activity'), 'circle-alert');
  bind(
    '#import-game',
    async () => {
      const games = await window.mamba.importGame();
      if (games) {
        renderLibrary(games);
        showToast('Existing game added');
      }
    },
    'folder-plus',
  );
  bind('#refresh-activity', loadActivity, 'refresh-cw');
  bind(
    '#stop-sync',
    async () => {
      await window.mamba.stopSync();
      await loadActivity();
    },
    'pause',
  );
  bind(
    '#restart-tasks',
    async () => {
      if (await window.mamba.restartTasks()) {
        showToast('Background tasks restarted');
        await loadActivity();
      }
    },
    'rotate-ccw',
  );
  bind(
    '#check-storage',
    async () => {
      const space = await window.mamba.storage();
      $('#storage-status').textContent =
        space.free === null
          ? 'The folder is writable. Free space could not be read.'
          : formatBytes(space.free) +
            ' available in your Games folder. Each download is checked again before extraction.';
    },
    'folder-open',
  );
  bind(
    '#export-diagnostics',
    async () => {
      if (await window.mamba.exportDiagnostics())
        showToast('Diagnostics exported without API keys, file paths or download links');
    },
    'download',
  );
  window.mamba.jobs().then(renderJobs).catch(handleError);

  if (configLoaded) configReady.then((config) => api.configure(config)).catch(handleError);
  window.mamba
    .activity()
    .then((status) => renderIssues(status.issues))
    .catch(() => {});
  window.mamba.onIssues(renderIssues);
  window.mamba.onNotice((notice) => {
    showToast(
      notice.name +
        (notice.status === 'completed'
          ? ' is ready to play'
          : notice.status === 'needs-setup'
            ? ' needs installation review'
            : ' needs attention — open Activity'),
    );
    if (currentPage === 'activity') loadActivity();
  });
  window.mamba.onNavigate(async (target) => {
    if (target.page === 'activity') return showPage('activity');
    const game = installedGames.find((item) => item.folder === target.folder);
    await openGame(game || { id: target.id, name: 'Game details' }, game ? 'library' : 'search');
  });
  window.addEventListener('error', (event) => {
    if (event.message) handleError(new Error(event.message));
  });
  window.addEventListener('unhandledrejection', (event) => {
    event.preventDefault();
    handleError(event.reason);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentPage === 'activity') loadActivity();
  });
  setInterval(() => {
    if (currentPage === 'activity' && !document.hidden) loadActivity();
  }, 5000);
})();

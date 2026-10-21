(() => {
  const $ = (selector) => document.querySelector(selector);
  let games = [],
    total = 0,
    pending = false,
    loading = false;
  const queueing = new Set();
  const labels = { torbox: 'TorBox', realdebrid: 'Real-Debrid', direct: 'Direct' };
  const node = (tag, text, className) => {
    const item = document.createElement(tag);
    if (text !== undefined) item.textContent = text;
    if (className) item.className = className;
    return item;
  };
  const toolbar = node('div', undefined, 'discovery-toolbar');
  const makeSelect = (label, options) => {
    const select = node('select', undefined, 'discovery-select');
    select.setAttribute('aria-label', label);
    for (const [value, text] of options) {
      const option = node('option', text);
      option.value = value;
      select.append(option);
    }
    select.onchange = render;
    return select;
  };
  const service = makeSelect('Filter download service', [
    ['all', 'All services'],
    ['torbox', 'TorBox'],
    ['realdebrid', 'Real-Debrid'],
    ['direct', 'Direct downloads'],
  ]);
  const availability = makeSelect('Filter game availability', [
    ['all', 'All games'],
    ['installed', 'Installed'],
    ['new', 'Not installed'],
  ]);
  const sort = makeSelect('Sort search results', [
    ['relevance', 'Best match'],
    ['name', 'Name A–Z'],
    ['year', 'Newest release'],
  ]);
  toolbar.append(service, availability, sort);
  $('#results-list').before(toolbar);
  function render() {
    if (loading) return;
    const library = installedGames;
    const ownership = new Map(
      games.map((game) => [game.id, window.MambaPresence.installed(library, game)]),
    );
    let matches = games.filter((game) => {
      const owned = ownership.get(game.id);
      return (
        (service.value === 'all' ||
          (game.options || []).some((option) =>
            (option.services || ['torbox']).includes(service.value),
          )) &&
        (availability.value === 'all' || (availability.value === 'installed' ? !!owned : !owned))
      );
    });
    if (sort.value === 'name') matches.sort((a, b) => a.name.localeCompare(b.name));
    if (sort.value === 'year')
      matches.sort((a, b) => (Number(b.releaseYear) || 0) - (Number(a.releaseYear) || 0));
    const list = $('#results-list');
    const cards = document.createDocumentFragment();
    list.replaceChildren();
    for (const game of matches) {
      const owned = ownership.get(game.id);
      const job = window.MambaPresence.download(window.MambaExperience?.jobs || [], game);
      const row = node('article', undefined, 'result-card game-cover-card discovery-card');
      const cover = button(
        '',
        () => window.MambaExperience.openGame(game, 'search'),
        null,
        'game-cover',
      );
      cover.setAttribute('aria-label', 'View ' + game.name);
      cover.append($('#library-empty svg').cloneNode(true));
      (game.cover ? Promise.resolve(game.cover) : window.mamba.artwork(game.id))
        .then((image) => {
          if (!image || !cover.isConnected) return;
          const img = node('img');
          img.src = image;
          img.alt = game.name;
          img.loading = 'lazy';
          img.onload = () => cover.classList.add('has-cover');
          img.onerror = () => img.remove();
          cover.append(img);
        })
        .catch(() => {});
      if (owned) {
        const badge = node(
          'span',
          owned.status === 'installed' ? 'Installed' : 'Setup required',
          'owned-badge',
        );
        cover.append(badge);
      }
      const info = node('div', undefined, 'result-info');
      const title = node('h2');
      title.append(
        button(
          game.name,
          () => window.MambaExperience.openGame(game, 'search'),
          null,
          'result-title',
        ),
      );
      info.append(title);
      const methods = [
        ...new Set((game.options || []).flatMap((option) => option.services || ['torbox'])),
      ];
      info.append(
        node(
          'p',
          [
            game.releaseYear,
            game.downloadSize,
            methods
              .map((id) => labels[id])
              .filter(Boolean)
              .join(' · '),
          ]
            .filter(Boolean)
            .join(' · '),
          'game-card-meta',
        ),
      );
      const actions = node('div', undefined, 'result-actions game-result-action');
      let control;
      if (owned?.status === 'installed' && owned.executable)
        control = button(
          'Play',
          () => window.MambaExperience.play(owned),
          'play',
          'primary-button',
        );
      else if (job && ['paused', 'failed'].includes(job.status))
        control = button(
          job.status === 'paused' ? 'Resume' : 'Retry',
          async () => {
            await window.mamba.retry(job.id);
            showPage('activity');
          },
          'rotate-ccw',
          'secondary-button',
        );
      else if (
        job &&
        ['queued', 'preparing', 'downloading', 'extracting', 'installing'].includes(job.status)
      )
        control = button(
          'View download',
          () => showPage('activity'),
          'download',
          'secondary-button',
        );
      else if (owned || job?.status === 'completed')
        control = button(
          owned ? 'Review setup' : 'View game',
          () => window.MambaExperience.openGame(game, 'search'),
          owned ? 'settings-2' : 'arrow-right',
          'secondary-button',
        );
      else {
        control = button(
          'Download',
          async (event) => {
            if (event.shiftKey) return window.MambaExperience.openGame(game, 'search');
            if (queueing.has(game.id)) return;
            queueing.add(game.id);
            control.dataset.locked = 'true';
            render();
            try {
              const id = await window.mamba.downloadBest(game.id);
              cardJobs.set(game.id, id);
              showToast(game.name + ' added to downloads');
            } catch (error) {
              delete control.dataset.locked;
              throw error;
            } finally {
              queueing.delete(game.id);
              render();
            }
          },
          'download',
          'primary-button',
        );
        control.title = 'Download · Shift-click to choose a version';
        if (queueing.has(game.id) || cardJobs.has(game.id)) {
          control.lastChild.textContent = 'Queued';
          control.disabled = true;
          control.dataset.locked = 'true';
        }
      }
      actions.append(control);
      row.append(cover, info, actions);
      cards.append(row);
    }
    list.append(cards);
    if (!matches.length)
      list.append(
        node(
          'p',
          games.length
            ? 'No games match these filters.'
            : pending
              ? 'Checking Steam…'
              : 'No games found. Try another name.',
          'search-no-results',
        ),
      );
    $('#results-status').textContent =
      (service.value !== 'all' || availability.value !== 'all'
        ? matches.length + ' shown · '
        : '') +
      total.toLocaleString() +
      ' ' +
      (total === 1 ? 'game' : 'games') +
      (pending ? ' · More matches are being checked' : '');
  }
  window.MambaDiscovery = {
    render,
    start(more) {
      loading = true;
      $('#results-more').disabled = true;
      if (!more) games = [];
    },
    fail(message) {
      loading = false;
      $('#results-more').disabled = false;
      $('#results-status').textContent = message;
    },
    update(result, more) {
      loading = false;
      $('#results-more').disabled = false;
      games = more
        ? [...games, ...result.items.filter((item) => !games.some((game) => game.id === item.id))]
        : result.items;
      total = result.total;
      pending = !!result.pending;
      render();
    },
  };
})();

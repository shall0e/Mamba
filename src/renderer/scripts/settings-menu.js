(() => {
  const $ = (selector) => document.querySelector(selector);
  const node = (tag, text, cls) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  };
  let config = {},
    hosts = [],
    disabledHosts = [],
    disabledSources = [];
  const form = $('#settings-form');
  const layout = node('div', undefined, 'settings-layout');
  const nav = node('nav', undefined, 'settings-nav');
  nav.setAttribute('aria-label', 'Settings categories');
  form.before(layout);
  layout.append(nav, form);
  const panels = {};
  const groups = [
    ['downloads', 'Downloads', ['install-title', 'experience-settings-title'], 'download'],
    ['services', 'Services', ['connection-title'], 'settings-2'],
    ['sources', 'Sources', ['sources-title'], 'folder-open'],
    ['appearance', 'Appearance', [], 'eye'],
    ['app', 'App', ['updates-title', 'config-transfer-title'], 'info'],
  ];
  for (const [id, label, headings, symbol] of groups) {
    const panel = node('section', undefined, 'settings-panel');
    panel.id = 'settings-' + id;
    panel.setAttribute('aria-label', label);
    panel.hidden = id !== 'downloads';
    panels[id] = panel;
    form.append(panel);
    for (const heading of headings)
      panel.append(document.getElementById(heading).closest('.settings-card'));
    const control = button(
      label,
      () => {
        for (const [key, value] of Object.entries(panels)) value.hidden = key !== id;
        for (const item of nav.children) {
          const selected = item === control;
          item.classList.toggle('selected', selected);
          if (selected) item.setAttribute('aria-current', 'page');
          else item.removeAttribute('aria-current');
        }
        if (id === 'sources') loadHosts();
      },
      symbol,
      'settings-category',
    );
    if (id === 'downloads') {
      control.classList.add('selected');
      control.setAttribute('aria-current', 'page');
    }
    nav.append(control);
  }
  const appearance = $('.appearance-card');
  appearance.open = true;
  panels.appearance.append(appearance);
  const testing = node('section', undefined, 'settings-card');
  testing.append(
    node('h2', 'Testing'),
    node(
      'p',
      'Replay startup or walk through setup again. Your games, saved keys, and settings are kept. Active downloads may need to be resumed after restarting.',
      'field-hint',
    ),
  );
  const testingActions = node('div', undefined, 'settings-actions');
  const restart = (firstRun) => async (event) => {
    const control = event.currentTarget;
    control.disabled = true;
    try {
      await window.torboxSettings.testRestart(firstRun);
    } catch (error) {
      control.disabled = false;
      showToast(error.message || 'Could not restart Mamba.');
    }
  };
  testingActions.append(
    button('Restart Mamba', restart(false), 'refresh-cw', 'secondary-button'),
    button('Restart as a new user', restart(true), 'refresh-cw', 'secondary-button'),
  );
  testing.append(testingActions);
  panels.app.append(testing);
  const heading = $('#settings-title').parentElement;
  heading.querySelector('.page-description')?.remove();
  heading.querySelector('.page-eyebrow')?.remove();
  $('#connection-title').textContent = 'TorBox';
  $('#connection-title').nextElementSibling.textContent = 'Torrents and supported file hosts.';
  $('#connection-title').closest('.settings-card').append($('#cached-only').closest('.switch-row'));
  document.querySelector('label[for="transfer-timeout"]').textContent =
    'Preparation timeout (minutes)';
  nav.children[3].prepend($('#key-visibility .lucide-eye').cloneNode(true));
  const switches = {};
  function serviceSwitch(id, title, description) {
    const row = node('label', undefined, 'switch-row service-switch');
    const copy = node('span');
    copy.append(node('strong', title), node('small', description));
    const input = node('input');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.setAttribute('aria-label', 'Use ' + title);
    input.onchange = () => scheduleSettingsSave(200);
    row.append(copy, input);
    switches[id] = input;
    return row;
  }
  $('#connection-title')
    .closest('.settings-card')
    .prepend(serviceSwitch('torbox', 'TorBox', 'Use your TorBox account.'));
  const rd = node('section', undefined, 'settings-card service-card');
  rd.append(
    serviceSwitch('realdebrid', 'Real-Debrid', 'Torrents and hosts supported by your account.'),
  );
  const rdLabel = node('label', 'API token', 'field-label');
  rdLabel.htmlFor = 'realdebrid-key';
  const rdKey = node('input', undefined, 'settings-input');
  rdKey.id = 'realdebrid-key';
  rdKey.type = 'password';
  rdKey.autocomplete = 'off';
  rdKey.placeholder = 'Paste your Real-Debrid API token';
  rdKey.oninput = () => scheduleSettingsSave(700);
  const rdNote = node('div', undefined, 'key-note');
  const rdStatus = node('p', 'No token saved', 'field-hint');
  rdStatus.id = 'realdebrid-status';
  const clear = button(
    'Remove token',
    async () => {
      const result = await window.mamba.clearServiceKey('realdebrid');
      saved(result);
      showToast('Real-Debrid token removed.');
    },
    null,
    'text-button remove-key',
  );
  clear.id = 'realdebrid-clear';
  rdNote.append(rdStatus, clear);
  rd.append(rdLabel, rdKey, rdNote);
  panels.services.append(rd);
  const direct = node('section', undefined, 'settings-card service-card');
  direct.append(
    serviceSwitch(
      'direct',
      'Direct downloads',
      'Pixeldrain files and lists, plus direct archive links. No service key required.',
    ),
  );
  panels.services.append(direct);
  const defaults = node('section', undefined, 'settings-card');
  defaults.append(node('h2', 'Default service'));
  const select = node('select', undefined, 'settings-input');
  select.id = 'download-service';
  select.setAttribute('aria-label', 'Default download service');
  for (const [value, label] of [
    ['auto', 'Automatic'],
    ['torbox', 'TorBox'],
    ['realdebrid', 'Real-Debrid'],
    ['direct', 'Direct downloads'],
  ]) {
    const option = node('option', label);
    option.value = value;
    select.append(option);
  }
  select.onchange = () => scheduleSettingsSave(200);
  defaults.append(
    select,
    node(
      'p',
      'Automatic uses an enabled service that supports the selected link. You can choose a service for each download.',
      'field-hint',
    ),
  );
  panels.services.append(defaults);
  const sourcesCard = $('#sources-title').closest('.settings-card');
  $('#sources-title').nextElementSibling.textContent = 'Choose which catalogs to search.';
  const sourceList = node('div', undefined, 'source-picker');
  sourcesCard.querySelector('.settings-card-heading').after(sourceList);
  const edit = node('details', undefined, 'source-editor');
  edit.append(node('summary', 'Edit source URLs'));
  for (const id of ['source-urls', 'source-error', 'source-urls-hint'])
    edit.append(document.getElementById(id));
  sourcesCard.append(edit);
  const hostCard = node('section', undefined, 'settings-card');
  hostCard.append(
    node('h2', 'Download hosts'),
    node('p', 'Choose which hosts can supply your downloads.', 'field-hint'),
  );
  const hostList = node('div', undefined, 'host-picker');
  hostCard.append(hostList);
  panels.sources.append(hostCard);
  function checkRow(title, detail, checked, change) {
    const row = node('label', undefined, 'host-row');
    const text = node('span');
    text.append(node('strong', title));
    if (detail) text.append(node('small', detail));
    const input = node('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.onchange = () => {
      change(input.checked);
      scheduleSettingsSave(250);
    };
    row.append(text, input);
    return row;
  }
  function renderSources() {
    sourceList.replaceChildren();
    for (const uri of sourceLines()) {
      let title = uri;
      try {
        const url = new URL(uri);
        title =
          decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || url.hostname) +
          ' · ' +
          url.hostname;
      } catch {}
      sourceList.append(
        checkRow(title, '', !disabledSources.includes(uri), (checked) => {
          disabledSources = checked
            ? disabledSources.filter((item) => item !== uri)
            : [...new Set([...disabledSources, uri])];
        }),
      );
    }
    if (!sourceLines().length)
      sourceList.append(node('p', 'Add a source URL below.', 'field-hint'));
  }
  $('#source-urls').addEventListener('input', renderSources);
  function renderHosts() {
    hostList.replaceChildren();
    for (const { host, count } of hosts) {
      const direct = host === 'pixeldrain.com';
      hostList.append(
        checkRow(
          host === 'torrent' ? 'Torrents' : host,
          count.toLocaleString() +
            ' links · ' +
            (direct
              ? 'Direct or connected service'
              : host === 'torrent'
                ? 'TorBox or Real-Debrid'
                : 'Requires a compatible connected service'),
          !disabledHosts.includes(host),
          (checked) => {
            disabledHosts = checked
              ? disabledHosts.filter((item) => item !== host)
              : [...new Set([...disabledHosts, host])];
          },
        ),
      );
    }
    if (!hosts.length)
      hostList.append(node('p', 'Sync sources to see their download hosts.', 'field-hint'));
  }
  async function loadHosts() {
    try {
      hosts = await window.mamba.downloadOptions();
      renderHosts();
    } catch {
      hostList.replaceChildren(
        node('p', 'Host list is unavailable. Sync sources and try again.', 'field-hint'),
      );
    }
  }
  function saved(value) {
    config = { ...config, ...value };
    rdKey.value = '';
    rdKey.placeholder = config.realDebridConfigured
      ? 'Token saved · enter a new token to replace'
      : 'Paste your Real-Debrid API token';
    rdStatus.textContent = config.realDebridConfigured
      ? 'Token saved on this device'
      : 'No token saved';
    clear.hidden = !config.realDebridConfigured;
  }
  function configure(value) {
    config = value;
    for (const [id, input] of Object.entries(switches))
      input.checked = (value.enabledDownloadServices || ['torbox', 'direct']).includes(id);
    select.value = value.preferredDownloadService || 'auto';
    disabledHosts = [...(value.disabledDownloadHosts || [])];
    disabledSources = [...(value.disabledSourceUrls || [])];
    saved(value);
    renderSources();
    loadHosts();
  }
  window.MambaSettings = {
    configure,
    saved,
    loadHosts,
    busy(value) {
      for (const input of form.querySelectorAll('input,select,textarea,button'))
        input.disabled = value;
      clear.hidden = !config.realDebridConfigured;
    },
    read: () => ({
      enabledDownloadServices: Object.entries(switches)
        .filter(([, input]) => input.checked)
        .map(([id]) => id),
      preferredDownloadService: select.value,
      disabledDownloadHosts: disabledHosts,
      disabledSourceUrls: disabledSources,
    }),
    hasKeyChange: () => !!rdKey.value.trim(),
    key: () => rdKey.value,
  };
  if (configLoaded) configReady.then(configure);
})();

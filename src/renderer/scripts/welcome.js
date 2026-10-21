(() => {
  const make = (tag, text, cls) => {
    const el = document.createElement(tag);
    if (text) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  };
  const splash = document.querySelector('#startup-splash');
  window.mamba
    .updateState()
    .then((state) => {
      const version = document.querySelector('#startup-version');
      version.textContent = state.version ? 'v' + state.version : '';
      version.hidden = !state.version;
      const homeVersion = document.querySelector('#search-version');
      homeVersion.textContent = version.textContent;
      homeVersion.hidden = version.hidden;
    })
    .catch(() => {});
  async function setup(config) {
    const dialog = make('dialog', null, 'welcome-dialog');
    dialog.setAttribute('aria-labelledby', 'welcome-title');
    document.body.append(dialog);
    let step = 0,
      busy = false;
    let highlighted = null;
    const values = {
      downloadPath: config.downloadPath,
      apiKey: '',
      realDebridApiKey: '',
      autoInstall: config.autoInstall,
      notifications: config.notifications,
      preferredRelease: 'portable',
      direct: (config.enabledDownloadServices || ['direct']).includes('direct'),
      torbox: config.configured,
      realdebrid: config.realDebridConfigured,
    };
    const tours = [
      {
        page: 'search',
        target: '#search-open',
        title: 'Home',
        copy: 'Search for a game. Shift-click Download to choose a version.',
      },
      {
        page: 'library',
        target: '#library-open',
        title: 'Library',
        copy: 'Launch installed games or change their startup file.',
      },
      {
        page: 'activity',
        target: '#activity-open',
        title: 'Activity',
        copy: 'Manage downloads, check progress, and retry errors.',
      },
      {
        page: 'settings',
        target: '#settings-open',
        title: 'Settings',
        copy: 'Manage sources, services, and appearance. Changes save automatically.',
      },
    ];
    function field(label, input) {
      const wrapper = make('label', null, 'welcome-field');
      wrapper.append(make('span', label), input);
      return wrapper;
    }
    function check(label, key) {
      const input = make('input');
      input.type = 'checkbox';
      input.checked = values[key];
      input.onchange = () => (values[key] = input.checked);
      return field(label, input);
    }
    const motion = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;
    async function changeStep(next) {
      if (busy) return;
      busy = true;
      if (motion())
        await dialog.animate(
          [
            { opacity: 1, filter: 'blur(0px)', transform: 'translateY(0)' },
            { opacity: 0, filter: 'blur(9px)', transform: 'translateY(-8px)' },
          ],
          { duration: 170, easing: 'ease-in', fill: 'forwards' },
        ).finished;
      step = next;
      draw();
      dialog.getAnimations().forEach((animation) => animation.cancel());
      if (motion())
        dialog.animate(
          [
            { opacity: 0, filter: 'blur(12px)', transform: 'translateY(16px) scale(.98)' },
            { opacity: 1, filter: 'blur(0px)', transform: 'translateY(0) scale(1)' },
          ],
          { duration: 520, easing: 'cubic-bezier(.22,1,.36,1)' },
        );
      busy = false;
    }
    async function finish() {
      await window.torboxSettings.completeSetup();
      highlighted?.classList.remove('tour-highlight');
      if (motion())
        await dialog.animate(
          [
            { opacity: 1, filter: 'blur(0)' },
            { opacity: 0, filter: 'blur(12px)' },
          ],
          { duration: 240, fill: 'forwards' },
        ).finished;
      dialog.close();
      dialog.remove();
      showPage('search');
    }
    function service(id, label, description, keyName, saved) {
      const card = make('section', null, 'welcome-service');
      const row = check(label, id);
      card.append(row);
      card.classList.toggle('selected', !!values[id]);
      const checkbox = row.querySelector('input');
      const credentials = make('div', null, 'welcome-credential');
      if (keyName) {
        const input = make('input');
        input.type = 'password';
        input.autocomplete = 'off';
        input.value = values[keyName];
        input.placeholder = saved ? 'Saved key will be used' : 'Paste your API key';
        input.oninput = () => (values[keyName] = input.value);
        credentials.append(field(label + ' API key', input));
        credentials.hidden = !values[id];
        card.append(credentials);
      }
      checkbox.onchange = () => {
        values[id] = checkbox.checked;
        card.classList.toggle('selected', checkbox.checked);
        if (keyName) credentials.hidden = !checkbox.checked;
      };
      return card;
    }
    function draw() {
      highlighted?.classList.remove('tour-highlight');
      highlighted = null;
      dialog.replaceChildren();
      dialog.classList.toggle('is-tour', step >= 3);
      const eyebrow = make(
        'p',
        step < 3 ? `Setup · ${step + 1} / 3` : `Tour · ${step - 2} / 4`,
        'welcome-eyebrow',
      );
      dialog.append(eyebrow);
      const progress = make('div', null, 'welcome-progress');
      progress.setAttribute('aria-label', step < 3 ? 'Setup progress' : 'Tour progress');
      for (let i = 0; i < (step < 3 ? 3 : 4); i++) {
        const dot = make('span');
        dot.classList.toggle('current', i === (step < 3 ? step : step - 3));
        dot.classList.toggle('done', i < (step < 3 ? step : step - 3));
        progress.append(dot);
      }
      dialog.append(progress);
      const title = make('h1', null);
      title.id = 'welcome-title';
      const body = make('div', null, 'welcome-body');
      dialog.append(title, body);
      if (step === 0) {
        title.textContent = 'Games folder';
        const path = make('input');
        path.type = 'text';
        path.value = values.downloadPath;
        path.oninput = () => (values.downloadPath = path.value);
        body.append(field('Games folder', path));
        const browse = make('button', 'Choose folder', 'secondary-button');
        browse.onclick = async () => {
          try {
            const selected = await window.mamba.chooseFolder();
            if (selected) {
              values.downloadPath = selected;
              path.value = selected;
            }
          } catch (error) {
            errorLine.textContent = error.message;
          }
        };
        body.append(browse);
      } else if (step === 1) {
        title.textContent = 'Download services';
        body.append(
          service('direct', 'Direct downloads', 'Supported direct links. No account needed.'),
          service(
            'torbox',
            'TorBox',
            'Torrents and file hosts supported by your account.',
            'apiKey',
            config.configured,
          ),
          service(
            'realdebrid',
            'Real-Debrid',
            'Torrents and hosts supported by Real-Debrid.',
            'realDebridApiKey',
            config.realDebridConfigured,
          ),
        );
      } else if (step === 2) {
        title.textContent = 'Preferences';
        const select = make('select');
        for (const [value, label] of [
          ['portable', 'Prefer portable / pre-installed'],
          ['any', 'Any release'],
          ['repack', 'Prefer repacks'],
          ['original', 'Prefer original releases'],
        ]) {
          const option = make('option', label);
          option.value = value;
          select.append(option);
        }
        select.value = values.preferredRelease;
        select.onchange = () => (values.preferredRelease = select.value);
        body.append(
          field('Download preference', select),
          check('Automatically unpack and prepare games', 'autoInstall'),
          check('Notify me when a download needs attention', 'notifications'),
        );
      } else {
        const tour = tours[step - 3];
        showPage(tour.page);
        highlighted = document.querySelector(tour.target);
        highlighted?.classList.add('tour-highlight');
        title.textContent = tour.title;
        body.append(make('p', tour.copy));
      }
      const errorLine = make('p', null, 'welcome-error');
      errorLine.setAttribute('role', 'alert');
      dialog.append(errorLine);
      const footer = make('div', null, 'welcome-actions');
      const back = make('button', 'Back', 'secondary-button');
      back.disabled = step === 0;
      back.onclick = () => changeStep(step - 1);
      const next = make(
        'button',
        step === 6 ? 'Done' : step === 2 ? 'Save' : 'Next',
        'primary-button',
      );
      next.onclick = async () => {
        if (busy) return;
        if (step === 1 && !values.direct && !values.torbox && !values.realdebrid) {
          errorLine.textContent = 'Choose at least one download option.';
          return;
        }
        if (step === 1 && values.torbox && !config.configured && !values.apiKey.trim()) {
          errorLine.textContent = 'Add a TorBox API key, or use direct downloads for now.';
          return;
        }
        if (
          step === 1 &&
          values.realdebrid &&
          !config.realDebridConfigured &&
          !values.realDebridApiKey.trim()
        ) {
          errorLine.textContent = 'Add a Real-Debrid API key, or switch it off for now.';
          return;
        }
        busy = true;
        next.disabled = true;
        back.disabled = true;
        try {
          if (step === 2) {
            config = await window.torboxSettings.saveConfig({
              apiKey: values.apiKey,
              realDebridApiKey: values.realDebridApiKey,
              sourceUrls: config.sourceUrls,
              downloadPath: values.downloadPath.trim(),
              autoInstall: values.autoInstall,
              notifications: values.notifications,
              preferredRelease: values.preferredRelease,
              enabledDownloadServices: [
                ...(values.direct ? ['direct'] : []),
                ...(values.torbox ? ['torbox'] : []),
                ...(values.realdebrid ? ['realdebrid'] : []),
              ],
              preferredDownloadService: 'auto',
            });
            applyLoadedConfig(config);
            values.apiKey = '';
            values.realDebridApiKey = '';
          }
          if (step === 6) {
            await finish();
            return;
          }
          busy = false;
          await changeStep(step + 1);
        } catch (error) {
          errorLine.textContent = String(
            error.message || 'Could not save your settings. Please try again.',
          );
          next.disabled = false;
          back.disabled = step === 0;
        } finally {
          busy = false;
        }
      };
      footer.append(back, next);
      if (step >= 3) {
        const skip = make('button', 'Skip tour', 'text-button');
        skip.onclick = async () => {
          if (busy) return;
          busy = true;
          try {
            await finish();
          } catch (error) {
            errorLine.textContent = error.message;
          } finally {
            busy = false;
          }
        };
        footer.insertBefore(skip, next);
      }
      dialog.append(footer);
      next.focus();
    }
    dialog.addEventListener('cancel', (event) => event.preventDefault());
    draw();
    dialog.showModal();
  }
  // The shell must become usable independently of settings, artwork, or IPC.
  document.body.classList.remove('startup-active', 'startup-finishing', 'startup-handoff');
  splash.remove();
  configReady
    .then(async (config) => {
      if (config.onboardingCompleted === false) await setup(config);
    })
    .catch(() => {});
})();

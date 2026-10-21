(() => {
  const $ = (selector) => document.querySelector(selector);
  const model = window.MambaThemes;
  const node = (tag, text, cls) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  };
  let theme = model.fromPalette(),
    custom = [],
    currentId = 'custom';
  const old = $('.appearance-card');
  const panel = node('section', undefined, 'settings-card appearance-panel');
  panel.setAttribute('aria-label', 'Appearance');
  const top = node('div', undefined, 'appearance-heading');
  top.append(node('h2', 'Appearance'));
  const picker = node('select', undefined, 'settings-input theme-picker');
  picker.setAttribute('aria-label', 'Theme');
  top.append(picker);
  panel.append(top);
  const descriptions = {
    background: 'Background color and artwork tint',
    foreground: 'Cards and panels',
    input: 'Input fields, selected controls, and download buttons',
    icons: 'Icons and Play buttons',
    text: 'Headings and section titles',
    supportingText: 'Descriptions, labels, and button text',
  };
  const sectionList = node('div', undefined, 'theme-section-list');
  sectionList.setAttribute('aria-label', 'Appearance sections');
  const editor = node('div', undefined, 'theme-side-editor');
  panel.append(sectionList, editor);
  let activeSection = 'background';
  const sectionButtons = {},
    sectionPanels = {},
    swatches = {};
  function selectSection(key) {
    activeSection = key;
    for (const [id, control] of Object.entries(sectionButtons)) {
      control.setAttribute('aria-pressed', String(id === key));
      sectionPanels[id].hidden = id !== key;
    }
  }
  function sectionButton(key, title, description) {
    const control = node('button', undefined, 'theme-section-button');
    control.type = 'button';
    control.setAttribute('aria-label', title);
    const copy = node('span', undefined, 'theme-section-copy');
    copy.append(node('strong', title));
    if (description) copy.append(node('small', description));
    control.append(copy);
    control.onclick = () => selectSection(key);
    sectionButtons[key] = control;
    sectionList.append(control);
    return control;
  }
  const controls = {},
    effectControls = {};
  for (const key of model.keys) {
    const title =
      key === 'supportingText' ? 'Supporting Text' : key[0].toUpperCase() + key.slice(1);
    const select = sectionButton(key, title, descriptions[key]);
    const swatch = node('span', undefined, 'theme-section-swatch');
    swatch.setAttribute('aria-hidden', 'true');
    select.append(swatch);
    swatches[key] = swatch;
    const group = node('section', undefined, 'theme-role');
    group.setAttribute('aria-label', title + ' controls');
    sectionPanels[key] = group;
    group.append(node('h3', title));
    const label = node('label', undefined, 'theme-color-row');
    const copy = node('span', 'Color');
    const input = node('input');
    input.type = 'color';
    input.setAttribute('aria-label', key[0].toUpperCase() + key.slice(1) + ' color');
    controls[key] = input;
    input.oninput = () => {
      theme.colors[key] = input.value;
      customize();
    };
    label.append(copy, input);
    group.append(label);
    effectControls[key] = {};
    const sliders = node('div', undefined, 'theme-role-effects');
    for (const property of ['opacity', 'blur']) {
      const row = node('label', undefined, 'theme-slider');
      const title = property[0].toUpperCase() + property.slice(1);
      const output = node('output');
      const slider = node('input');
      slider.type = 'range';
      slider.min = 0;
      slider.max = property === 'opacity' || key === 'background' ? 100 : 40;
      slider.step = 1;
      slider.id = 'theme-' + key + '-' + property;
      slider.setAttribute('aria-label', key + ' ' + property);
      output.htmlFor = slider.id;
      slider.oninput = () => {
        theme.effects[key][property] = Number(slider.value) / (property === 'opacity' ? 100 : 1);
        customize();
      };
      row.append(node('span', title), output, slider);
      sliders.append(row);
      effectControls[key][property] = { input: slider, output };
    }
    group.append(sliders);
    editor.append(group);
  }
  const textPreviews = {};
  for (const key of ['text', 'supportingText']) {
    const preview = node('div', undefined, 'theme-text-preview');
    preview.append(node('small', 'Preview'));
    const sample = node(
      key === 'text' ? 'h4' : 'p',
      key === 'text' ? 'Heading preview' : 'Supporting text preview',
    );
    preview.append(sample);
    sectionPanels[key].append(preview);
    textPreviews[key] = sample;
  }
  const share = node('section', undefined, 'theme-share');
  share.append(node('h3', 'Custom themes'));
  const nameLabel = node('label', 'Theme name', 'field-label');
  nameLabel.htmlFor = 'theme-name';
  const name = node('input', undefined, 'settings-input');
  name.id = 'theme-name';
  name.type = 'text';
  name.maxLength = 60;
  name.placeholder = 'My theme';
  const actions = node('div', undefined, 'settings-actions');
  const nameError = node('p', 'Enter a theme name.', 'field-error');
  nameError.hidden = true;
  nameError.id = 'theme-name-error';
  name.setAttribute('aria-describedby', nameError.id);
  const named = () => {
    if (!name.value.trim()) {
      nameError.hidden = false;
      name.setAttribute('aria-invalid', 'true');
      name.focus();
      return null;
    }
    nameError.hidden = true;
    name.setAttribute('aria-invalid', 'false');
    return model.parse({ ...theme, name: name.value.trim() });
  };
  name.oninput = () => {
    nameError.hidden = true;
    name.setAttribute('aria-invalid', 'false');
  };
  actions.append(
    button(
      'Save theme',
      async () => {
        const value = named();
        if (!value) return;
        const saved = await window.mamba.saveTheme(value);
        if (saved) {
          custom = custom.filter((row) => row.id !== saved.id);
          custom.push(saved);
          theme = saved.theme;
          currentId = saved.id;
          populate();
          apply();
          scheduleSettingsSave(100);
          showToast('Theme saved.');
        }
      },
      'check',
      'secondary-button',
    ),
  );
  actions.append(
    button(
      'Export theme',
      async () => {
        const value = named();
        if (value && (await window.mamba.exportTheme(value))) showToast('Theme exported.');
      },
      'download',
      'secondary-button',
    ),
  );
  actions.append(
    button(
      'Import theme',
      async () => {
        const entry = await window.mamba.importTheme();
        if (!entry) return;
        custom = custom.filter((row) => row.id !== entry.id);
        custom.push(entry);
        theme = entry.theme;
        currentId = entry.id;
        populate();
        apply();
        scheduleSettingsSave(100);
        showToast('Theme imported.');
      },
      'folder-open',
      'secondary-button',
    ),
  );
  const deleteTheme = button(
    'Delete theme',
    async () => {
      const saved = custom.find((row) => row.id === currentId);
      if (!saved || !(await window.mamba.deleteTheme(saved.id))) return;
      custom = custom.filter((row) => row.id !== saved.id);
      theme = model.parse(model.presets[0]);
      currentId = model.presets[0].name.toLowerCase();
      populate();
      apply();
      scheduleSettingsSave(100);
      showToast('Theme deleted.');
    },
    'trash-2',
    'secondary-button danger-action',
  );
  actions.append(deleteTheme);
  share.append(nameLabel, name, nameError, actions);
  editor.append(share);
  const legacy = $('#palette-fields');
  legacy.hidden = true;
  panel.append(legacy);
  old.replaceWith(panel);
  sectionButton('navigation', 'Navigation', 'Choose where page buttons appear');
  const navigationPanel = node('section', undefined, 'theme-role');
  navigationPanel.append(node('h3', 'Navigation'));
  const navigationLabel = node('label', undefined, 'field-label');
  navigationLabel.append(node('span', 'Position'));
  const navigationPosition = node('select', undefined, 'settings-input');
  navigationPosition.setAttribute('aria-label', 'Navigation position');
  for (const [value, label] of Object.entries(model.navigationPositions)) {
    const option = node('option', label);
    option.value = value;
    navigationPosition.append(option);
  }
  navigationPosition.onchange = () => {
    theme.navigation = { position: navigationPosition.value };
    customize();
  };
  navigationLabel.append(navigationPosition);
  navigationPanel.append(navigationLabel);
  sectionPanels.navigation = navigationPanel;
  editor.insertBefore(navigationPanel, share);
  const fontPanel = node('section', undefined, 'theme-fonts');
  fontPanel.append(node('h3', 'Fonts'));
  const fontControls = {};
  for (const role of Object.keys(model.fontRoles)) {
    const row = node('label', undefined, 'theme-font-row');
    row.append(node('span', model.fontRoles[role]));
    const select = node('select', undefined, 'settings-input');
    select.setAttribute('aria-label', model.fontRoles[role] + ' font');
    select.onchange = () => {
      theme.typography = { ...theme.typography, [role]: select.value };
      customize();
    };
    fontControls[role] = select;
    row.append(select);
    fontPanel.append(row);
  }
  const fontStatus = node('p', '', 'field-hint');
  fontPanel.append(fontStatus);
  sectionPanels.fonts = fontPanel;
  const fontsButton = sectionButton('fonts', 'Fonts', 'Fonts saved in this theme');
  editor.insertBefore(fontPanel, share);
  selectSection(activeSection);
  let fontGeneration = 0,
    loadedFaces = [],
    fontSignature = '';
  async function applyFonts() {
    const signature = JSON.stringify([theme.fonts, theme.typography]);
    if (signature === fontSignature) return;
    fontSignature = signature;
    const generation = ++fontGeneration;
    const faces = [];
    const snapshot = model.parse(theme);
    try {
      for (const [index, font] of (snapshot.fonts || []).entries()) {
        const bytes = Uint8Array.from(atob(font.data), (c) => c.charCodeAt(0));
        const face = new FontFace('MambaCustom' + generation + '_' + index, bytes.buffer);
        await face.load();
        faces.push(face);
      }
      if (generation !== fontGeneration) return;
      for (const face of loadedFaces) document.fonts.delete(face);
      loadedFaces = faces;
      for (const face of faces) document.fonts.add(face);
      for (const role of Object.keys(model.fontRoles)) {
        const index = (snapshot.fonts || []).findIndex(
          (font) => font.name === snapshot.typography?.[role],
        );
        document.documentElement.style.setProperty(
          '--font-' + role,
          index < 0
            ? 'var(--font-default)'
            : JSON.stringify(faces[index].family) + ', var(--font-default)',
        );
      }
      fontStatus.textContent = '';
    } catch {
      if (generation === fontGeneration) {
        fontSignature = '';
        fontStatus.textContent =
          'A font saved in this theme could not be loaded. Using the default font.';
        for (const role of Object.keys(model.fontRoles))
          document.documentElement.style.removeProperty('--font-' + role);
      }
    }
  }
  function populate() {
    picker.replaceChildren();
    for (const preset of model.presets) {
      const option = node('option', preset.name);
      option.value = preset.name.toLowerCase();
      picker.append(option);
    }
    for (const entry of custom) {
      const preset = model.presets.find(
        (value) => JSON.stringify(model.parse(value)) === JSON.stringify(model.parse(entry.theme)),
      );
      if (preset) {
        if (currentId === entry.id) currentId = preset.name.toLowerCase();
        continue;
      }
      const duplicate = model.presets.some(
        (value) => value.name.toLowerCase() === entry.theme.name.toLowerCase(),
      );
      const option = node('option', entry.theme.name + (duplicate ? ' (custom)' : ''));
      option.value = entry.id;
      picker.append(option);
    }
    if (currentId === 'custom') {
      const option = node('option', 'Custom');
      option.value = 'custom';
      picker.append(option);
    }
    picker.value = currentId;
    navigationPosition.value = theme.navigation.position;
    deleteTheme.disabled = !custom.some((row) => row.id === currentId);
    deleteTheme.title = deleteTheme.disabled
      ? 'Select a saved custom theme to delete'
      : 'Delete this saved theme';
    fontsButton.hidden = !theme.fonts?.length;
    if (activeSection === 'fonts' && fontsButton.hidden) selectSection('background');
    for (const [role, select] of Object.entries(fontControls)) {
      select.replaceChildren();
      const fallback = node('option', 'Default');
      fallback.value = '';
      select.append(fallback);
      for (const font of theme.fonts || []) {
        const option = node('option', font.name);
        option.value = font.name;
        select.append(option);
      }
      select.value = theme.typography?.[role] || '';
    }
    for (const key of model.keys) {
      controls[key].value = theme.colors[key];
      swatches[key].style.background = theme.colors[key];
      for (const property of ['opacity', 'blur']) {
        const value = theme.effects[key][property];
        effectControls[key][property].input.value =
          property === 'opacity' ? Math.round(value * 100) : value;
        effectControls[key][property].output.value =
          property === 'opacity'
            ? Math.round(value * 100) + '%'
            : Math.round(value * 10) / 10 + 'px';
        effectControls[key][property].input.style.setProperty(
          '--range-progress',
          (property === 'opacity'
            ? value * 100
            : (value / (key === 'background' ? 100 : 40)) * 100) + '%',
        );
      }
    }
    name.value = currentId === 'custom' ? '' : theme.name;
  }
  function apply() {
    for (const key of model.keys) swatches[key].style.background = theme.colors[key];
    applyFonts();
    document.documentElement.dataset.navigation = theme.navigation.position;
    applyPalette(model.palette(theme));
    const style = document.documentElement.style,
      copyColor = model.palette(theme).text;
    for (const key of model.keys) {
      style.setProperty('--' + key + '-opacity', String(theme.effects[key].opacity));
      style.setProperty('--' + key + '-blur', theme.effects[key].blur + 'px');
    }
    style.setProperty('--theme-text-color', theme.colors.text);
    style.setProperty('--theme-icons-color', theme.colors.icons);
    style.setProperty(
      '--background-glow-opacity',
      String(model.glowOpacity(theme.effects.foreground.opacity, theme.effects.background.blur)),
    );
    style.setProperty('--heading-color', theme.colors.text);
    style.setProperty('--body-ink', copyColor);
    style.setProperty('--button-ink', copyColor);
    style.setProperty('--heading-ink', theme.colors.text);
    style.setProperty('--icon-ink', theme.colors.icons);
    style.setProperty('--divider-ink', theme.colors.icons);
    style.setProperty('--scrollbar-ink', theme.colors.icons);
    style.setProperty('--contrast-ink', copyColor);
    for (const key of ['text', 'textSecondary', 'textMuted'])
      style.setProperty('--color-' + key, copyColor);
    style.setProperty('--play-ink', theme.colors.icons);
    for (const [key, sample] of Object.entries(textPreviews)) {
      sample.style.opacity = theme.effects[key].opacity;
      sample.style.filter = 'blur(' + theme.effects[key].blur + 'px)';
    }
    document.documentElement.dataset.theme = model.isLightBackground(theme.colors.background)
      ? 'light'
      : 'dark';
    for (const key of model.keys)
      for (const property of ['opacity', 'blur']) {
        const value = theme.effects[key][property];
        effectControls[key][property].output.value =
          property === 'opacity'
            ? Math.round(value * 100) + '%'
            : Math.round(value * 10) / 10 + 'px';
        effectControls[key][property].input.style.setProperty(
          '--range-progress',
          (property === 'opacity'
            ? value * 100
            : (value / (key === 'background' ? 100 : 40)) * 100) + '%',
        );
      }
  }
  function customize() {
    if (currentId !== 'custom') {
      currentId = 'custom';
      theme.name = 'Custom';
      populate();
    }
    apply();
    scheduleSettingsSave(650);
  }
  picker.onchange = () => {
    const selected =
      model.presets.find((item) => item.name.toLowerCase() === picker.value) ||
      custom.find((row) => row.id === picker.value)?.theme;
    if (!selected) return;
    theme = model.parse(selected);
    currentId = picker.value;
    populate();
    apply();
    scheduleSettingsSave(150);
  };
  async function configure(config) {
    theme = config.appearance ? model.parse(config.appearance) : model.fromPalette(config.palette);
    currentId =
      model.presets
        .find(
          (item) =>
            JSON.stringify(model.parse(item).colors) === JSON.stringify(theme.colors) &&
            JSON.stringify(model.parse(item).effects) === JSON.stringify(theme.effects) &&
            !theme.fonts?.length &&
            model.parse(item).navigation.position === theme.navigation.position,
        )
        ?.name.toLowerCase() || 'custom';
    try {
      custom = (await window.mamba.themes()) || [];
      const match = custom.find((row) => JSON.stringify(row.theme) === JSON.stringify(theme));
      if (match) currentId = match.id;
    } catch {
      custom = [];
    }
    populate();
    apply();
    Object.assign(downloadPreferences, read());
  }
  function read() {
    return { appearance: model.parse(theme), palette: model.palette(theme) };
  }
  window.MambaAppearance = { configure, read };
  if (configLoaded) configReady.then(configure);
})();

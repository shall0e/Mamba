(() => {
  // Appearance > Layout: arrange theme components without editing the theme file by hand.
  // Every change is stored as an override in the theme's "layout" section; anything left
  // at its original value is removed so the theme keeps following Mamba's defaults.
  const appearance = window.MambaAppearance;
  const model = window.MambaLayouts;
  if (!appearance?.addSection || !model) return;
  const node = (tag, text, cls) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  };
  const group = appearance.addSection('layout', 'Layout', 'Arrange cards and their parts');
  group.classList.add('layout-editor');
  group.append(node('h3', 'Layout'));
  const intro = node(
    'p',
    'Choose what each component shows, in which order, and its shape. Colors still come from your theme roles.',
    'field-hint',
  );
  const pickerLabel = node('label', 'Component', 'field-label');
  const picker = node('select', undefined, 'settings-input');
  picker.id = 'layout-component';
  pickerLabel.htmlFor = picker.id;
  for (const [name, spec] of Object.entries(model.components)) {
    const option = node('option', spec.label);
    option.value = name;
    picker.append(option);
  }
  const body = node('div', undefined, 'layout-editor-body');
  const status = node('p', '', 'field-error');
  status.setAttribute('role', 'status');
  status.hidden = true;
  group.append(intro, pickerLabel, picker, body, status);

  const current = () => appearance.layout.get() || { version: model.VERSION, components: {} };
  // Writes one component's settings, dropping anything that matches the original design.
  function save(name, entry) {
    const spec = model.components[name];
    const compact = {};
    if (entry.variant && entry.variant !== spec.defaultVariant) compact.variant = entry.variant;
    if (entry.slots && JSON.stringify(entry.slots) !== JSON.stringify(spec.defaultSlots))
      compact.slots = entry.slots;
    const style = {};
    for (const [token, value] of Object.entries(entry.style || {}))
      if (value !== spec.style[token].default) style[token] = value;
    if (Object.keys(style).length) compact.style = style;
    const layout = structuredClone(current());
    if (Object.keys(compact).length) layout.components[name] = compact;
    else delete layout.components[name];
    try {
      const parsed = model.parse(layout);
      status.hidden = true;
      appearance.layout.set(Object.keys(parsed.components).length ? parsed : null);
    } catch (error) {
      status.textContent = error.message;
      status.hidden = false;
    }
    draw();
  }
  const iconButton = (label, symbol, handler, disabled) => {
    const control = button('', handler, symbol, 'text-button layout-icon-button');
    control.setAttribute('aria-label', label);
    control.title = label;
    control.disabled = disabled;
    control.dataset.locked = String(disabled);
    return control;
  };
  function draw() {
    const name = picker.value;
    const spec = model.components[name];
    const resolved = model.resolve(current(), name);
    body.replaceChildren(node('p', spec.description, 'field-hint'));
    const variants = Object.entries(spec.variants);
    if (variants.length > 1) {
      const label = node('label', 'Style', 'field-label');
      const select = node('select', undefined, 'settings-input');
      select.id = 'layout-variant';
      label.htmlFor = select.id;
      for (const [value, text] of variants) {
        const option = node('option', text);
        option.value = value;
        select.append(option);
      }
      select.value = resolved.variant;
      select.onchange = () => save(name, { ...resolved, variant: select.value });
      body.append(label, select);
    }
    const slotNames = Object.keys(spec.slots);
    if (slotNames.length) {
      body.append(node('h4', 'Parts'));
      const list = node('ol', undefined, 'layout-slot-list');
      // Shown parts first in their order, then hidden parts.
      const ordered = [...resolved.slots, ...slotNames.filter((s) => !resolved.slots.includes(s))];
      ordered.forEach((slot) => {
        const shown = resolved.slots.includes(slot);
        const index = resolved.slots.indexOf(slot);
        const row = node('li', undefined, 'layout-slot');
        const toggle = node('label', undefined, 'layout-slot-toggle');
        const checkbox = node('input');
        checkbox.type = 'checkbox';
        checkbox.checked = shown;
        checkbox.onchange = () =>
          save(name, {
            ...resolved,
            slots: checkbox.checked
              ? [...resolved.slots, slot]
              : resolved.slots.filter((item) => item !== slot),
          });
        toggle.append(checkbox, node('span', spec.slots[slot]));
        const move = (offset) => () => {
          const slots = [...resolved.slots];
          [slots[index], slots[index + offset]] = [slots[index + offset], slots[index]];
          save(name, { ...resolved, slots });
        };
        row.append(
          toggle,
          iconButton(
            'Move ' + spec.slots[slot] + ' up',
            'arrow-up',
            move(-1),
            !shown || index === 0,
          ),
          iconButton(
            'Move ' + spec.slots[slot] + ' down',
            'arrow-down',
            move(1),
            !shown || index === resolved.slots.length - 1,
          ),
        );
        list.append(row);
      });
      body.append(list);
    }
    const tokens = Object.entries(spec.style);
    if (tokens.length) body.append(node('h4', 'Shape and spacing'));
    for (const [token, rule] of tokens) {
      const id = 'layout-' + name + '-' + token;
      if (rule.type === 'enum') {
        const label = node('label', rule.label, 'field-label');
        const select = node('select', undefined, 'settings-input');
        select.id = id;
        label.htmlFor = id;
        for (const value of rule.values) {
          const option = node('option', value[0].toUpperCase() + value.slice(1));
          option.value = value;
          select.append(option);
        }
        select.value = resolved.style[token];
        select.onchange = () =>
          save(name, { ...resolved, style: { ...resolved.style, [token]: select.value } });
        body.append(label, select);
        continue;
      }
      const row = node('label', undefined, 'theme-slider');
      const output = node('output');
      const slider = node('input');
      slider.type = 'range';
      slider.id = id;
      slider.min = rule.min;
      slider.max = rule.max;
      slider.step = 1;
      slider.value = resolved.style[token];
      output.htmlFor = id;
      const show = () => {
        output.value = slider.value + (rule.type === 'px' ? 'px' : '');
        slider.style.setProperty(
          '--range-progress',
          ((slider.value - rule.min) / (rule.max - rule.min)) * 100 + '%',
        );
      };
      show();
      slider.oninput = show;
      slider.onchange = () =>
        save(name, { ...resolved, style: { ...resolved.style, [token]: Number(slider.value) } });
      row.append(node('span', rule.label), output, slider);
      body.append(row);
    }
    const reset = button(
      'Reset to original',
      () => save(name, {}),
      'rotate-ccw',
      'secondary-button layout-reset',
    );
    reset.disabled = !current().components[name];
    reset.dataset.locked = String(reset.disabled);
    body.append(reset);
  }
  picker.onchange = draw;
  window.MambaComponents.onChange(draw);
  draw();
})();

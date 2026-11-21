(() => {
  // Builds UI components from slots in the order and variant the active theme chooses.
  // Callers supply one builder per slot (the data and behavior); the theme decides which
  // builders run, in what order, and how the result is styled.
  const model = window.MambaLayouts;
  let layout = null;
  let signature = '';
  const listeners = new Set();
  function render(name, builders, { tag = 'article', className = '' } = {}) {
    const spec = model.resolve(layout, name);
    const element = document.createElement(tag);
    element.className = ['mc', 'mc-' + name, className].filter(Boolean).join(' ');
    element.dataset.component = name;
    for (const [key, value] of Object.entries(model.attributes(layout, name)))
      element.dataset[key] = value;
    for (const slot of spec.slots) {
      const part = builders[slot]?.(spec);
      if (!part) continue;
      if (part.nodeType === 1) {
        part.dataset.slot = slot;
        part.classList.add('mc-slot');
      }
      element.append(part);
    }
    return element;
  }
  // Arranges already-built parts inside an existing container (for page-level components
  // whose container is part of the static page). Parts the theme hides are removed, or
  // with `keep` only hidden so static controls and their handlers stay in the document.
  // Shown parts are placed in order before `before` (an anchored child) or at the end.
  function mount(container, name, parts, { keep = false, before = null } = {}) {
    const spec = model.resolve(layout, name);
    container.classList.add('mc', 'mc-' + name);
    container.dataset.component = name;
    for (const [key, value] of Object.entries(model.attributes(layout, name)))
      container.dataset[key] = value;
    for (const [slot, part] of Object.entries(parts))
      if (part?.nodeType === 1 && !spec.slots.includes(slot)) {
        if (keep) part.hidden = true;
        else part.remove();
      }
    for (const slot of spec.slots) {
      const part = parts[slot];
      if (!part) continue;
      if (part.nodeType === 1) {
        part.dataset.slot = slot;
        if (keep) part.hidden = false;
      }
      container.insertBefore(part, before);
    }
    return spec;
  }
  function apply(next) {
    layout = next ? model.parse(next) : null;
    const style = document.documentElement.style;
    for (const [property, value] of Object.entries(model.cssVariables(layout)))
      style.setProperty(property, value);
    const updated = JSON.stringify(layout?.components || {});
    if (updated === signature) return;
    signature = updated;
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        console.error(error);
      }
    }
  }
  window.MambaComponents = {
    render,
    mount,
    apply,
    resolve: (name) => model.resolve(layout, name),
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get signature() {
      return signature;
    },
  };
  apply(null);
})();

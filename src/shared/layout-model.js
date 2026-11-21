(function (root) {
  // Theme layouts: which slots each component shows, in what order, its variant and a
  // small set of bounded style tokens. Mamba supplies components, data and behavior;
  // a theme only arranges and styles them. Anything a theme leaves out falls back to
  // the original Mamba design defined here.
  const VERSION = 1;
  const px = (min, max, fallback, label) => ({ type: 'px', min, max, default: fallback, label });
  const int = (min, max, fallback, label) => ({ type: 'int', min, max, default: fallback, label });
  const choice = (values, fallback, label) => ({ type: 'enum', values, default: fallback, label });
  const components = {
    'result-card': {
      label: 'Search result card',
      description: 'Games in search results.',
      slots: {
        artwork: 'Artwork',
        title: 'Title',
        meta: 'Release year and size',
        services: 'Download services',
        action: 'Play or download button',
      },
      defaultSlots: ['artwork', 'title', 'meta', 'services', 'action'],
      requireOneOf: ['artwork', 'title'],
      variants: { stacked: 'Stacked', overlay: 'Title over artwork', row: 'Horizontal row' },
      defaultVariant: 'stacked',
      style: {
        radius: px(0, 24, 8, 'Corner radius'),
        padding: px(0, 32, 16, 'Inner spacing'),
        gap: px(0, 24, 8, 'Space between slots'),
        titleLines: int(1, 3, 2, 'Title lines'),
        surface: choice(['foreground', 'input', 'none'], 'foreground', 'Card surface'),
        border: choice(['none', 'line'], 'line', 'Border'),
        action: choice(['label', 'icon'], 'label', 'Button style'),
      },
    },
    'result-grid': {
      label: 'Search results grid',
      description: 'How search result cards are arranged.',
      slots: {},
      defaultSlots: [],
      variants: { grid: 'Grid' },
      defaultVariant: 'grid',
      style: {
        columns: int(1, 5, 5, 'Maximum columns'),
        minWidth: px(160, 480, 240, 'Minimum card width'),
        gap: px(0, 48, 24, 'Space between cards'),
      },
    },
    'game-details': {
      label: 'Game details page',
      description: 'The sections of a game page and their order.',
      slots: {
        back: 'Back button',
        hero: 'Artwork, title and actions',
        metadata: 'Release details',
        overview: 'Overview',
        media: 'Screenshots and trailers',
        installation: 'Installation',
        content: 'Additional content',
        downloads: 'Available downloads',
      },
      defaultSlots: [
        'back',
        'hero',
        'metadata',
        'overview',
        'media',
        'installation',
        'content',
        'downloads',
      ],
      requireOneOf: ['hero'],
      variants: { standard: 'Standard' },
      defaultVariant: 'standard',
      style: {
        width: px(640, 1600, 900, 'Page width'),
        sectionGap: px(0, 64, 0, 'Extra space between sections'),
      },
    },
    'detail-hero': {
      label: 'Game details header',
      description: 'Artwork, title and actions at the top of a game page.',
      slots: {
        artwork: 'Artwork',
        eyebrow: 'Source label',
        title: 'Game title',
        status: 'Install status',
        actions: 'Play, download and other actions',
      },
      defaultSlots: ['artwork', 'eyebrow', 'title', 'status', 'actions'],
      requireOneOf: ['title'],
      variants: { cinematic: 'Centered artwork', split: 'Artwork beside details' },
      defaultVariant: 'cinematic',
      style: {
        artWidth: px(320, 1600, 900, 'Artwork width'),
        radius: px(0, 24, 8, 'Artwork corner radius'),
      },
    },
    'library-card': {
      label: 'Library card',
      description: 'Games in your Library grid.',
      slots: { artwork: 'Artwork', title: 'Title' },
      defaultSlots: ['artwork', 'title'],
      requireOneOf: ['artwork', 'title'],
      variants: { cover: 'Title on hover', captioned: 'Title below artwork' },
      defaultVariant: 'cover',
      style: {
        radius: px(0, 24, 8, 'Corner radius'),
        titleLines: int(1, 3, 2, 'Title lines'),
      },
    },
  };
  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const plain = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

  // Validates a theme's layout section. Unknown components, slots and tokens are ignored
  // (so themes made for newer versions still load) and reported as warnings; values of
  // the wrong type or out of range are errors, because they signal a broken theme.
  function inspect(value) {
    const warnings = [];
    if (value === undefined || value === null) return { layout: null, warnings };
    if (!plain(value)) throw Error('The theme layout must be an object.');
    if (JSON.stringify(value).length > 32768) throw Error('The theme layout is too large.');
    const version = value.version ?? VERSION;
    if (version !== VERSION)
      throw Error(
        Number(version) > VERSION
          ? 'This theme layout needs a newer version of Mamba.'
          : 'Unsupported theme layout version.',
      );
    const result = { version: VERSION, components: {} };
    if (value.components === undefined) return { layout: result, warnings };
    if (!plain(value.components)) throw Error('Theme layout components must be an object.');
    for (const [name, entry] of Object.entries(value.components)) {
      const spec = hasOwn(components, name) ? components[name] : null;
      if (!spec) {
        warnings.push('Unknown component "' + name + '" was ignored.');
        continue;
      }
      if (!plain(entry)) throw Error('Layout for ' + spec.label + ' must be an object.');
      const clean = {};
      if (entry.variant !== undefined) {
        if (!hasOwn(spec.variants, entry.variant))
          throw Error('Unknown variant "' + entry.variant + '" for ' + spec.label + '.');
        clean.variant = entry.variant;
      }
      if (entry.slots !== undefined) {
        if (!Array.isArray(entry.slots)) throw Error(spec.label + ' slots must be a list.');
        const slots = [];
        for (const slot of entry.slots) {
          if (typeof slot !== 'string' || !hasOwn(spec.slots, slot)) {
            warnings.push('Unknown slot "' + String(slot) + '" in ' + spec.label + ' was ignored.');
            continue;
          }
          if (!slots.includes(slot)) slots.push(slot);
        }
        if (spec.requireOneOf && !spec.requireOneOf.some((slot) => slots.includes(slot)))
          throw Error(
            spec.label +
              ' must show at least one of: ' +
              spec.requireOneOf.map((slot) => spec.slots[slot]).join(', ') +
              '.',
          );
        clean.slots = slots;
      }
      if (entry.style !== undefined) {
        if (!plain(entry.style)) throw Error(spec.label + ' style must be an object.');
        const style = {};
        for (const [token, raw] of Object.entries(entry.style)) {
          const rule = hasOwn(spec.style, token) ? spec.style[token] : null;
          if (!rule) {
            warnings.push('Unknown style "' + token + '" in ' + spec.label + ' was ignored.');
            continue;
          }
          if (rule.type === 'enum') {
            if (!rule.values.includes(raw))
              throw Error(
                rule.label + ' for ' + spec.label + ' must be one of: ' + rule.values.join(', '),
              );
            style[token] = raw;
          } else {
            const number = Number(raw);
            if (
              typeof raw !== 'number' ||
              !Number.isFinite(number) ||
              number < rule.min ||
              number > rule.max ||
              (rule.type === 'int' && !Number.isInteger(number))
            )
              throw Error(
                rule.label + ' for ' + spec.label + ' must be ' + rule.min + '–' + rule.max + '.',
              );
            style[token] = number;
          }
        }
        if (Object.keys(style).length) clean.style = style;
      }
      if (Object.keys(clean).length) result.components[name] = clean;
    }
    return { layout: result, warnings };
  }
  function parse(value) {
    return inspect(value).layout;
  }
  // Full settings for one component: the theme's choices layered over the original design.
  function resolve(layout, name) {
    const spec = components[name];
    if (!spec) throw Error('Unknown component ' + name + '.');
    const entry = layout?.components?.[name] || {};
    const style = {};
    for (const [token, rule] of Object.entries(spec.style))
      style[token] = entry.style && hasOwn(entry.style, token) ? entry.style[token] : rule.default;
    return {
      name,
      variant: entry.variant || spec.defaultVariant,
      slots: entry.slots ? [...entry.slots] : [...spec.defaultSlots],
      style,
    };
  }
  // Numeric tokens become CSS custom properties; enum tokens become data attributes.
  function cssVariables(layout) {
    const variables = {};
    for (const [name, spec] of Object.entries(components)) {
      const { style } = resolve(layout, name);
      for (const [token, rule] of Object.entries(spec.style)) {
        if (rule.type === 'enum') continue;
        variables['--' + name + '-' + token.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())] =
          rule.type === 'px' ? style[token] + 'px' : String(style[token]);
      }
    }
    return variables;
  }
  function attributes(layout, name) {
    const spec = components[name];
    const { style, variant } = resolve(layout, name);
    const result = { variant };
    for (const [token, rule] of Object.entries(spec.style))
      if (rule.type === 'enum') result[token] = style[token];
    return result;
  }
  const api = { VERSION, components, inspect, parse, resolve, cssVariables, attributes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MambaLayouts = api;
})(typeof window === 'undefined' ? globalThis : window);

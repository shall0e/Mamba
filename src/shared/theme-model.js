(function (root) {
  const keys = ['background', 'foreground', 'input', 'icons', 'text', 'supportingText'];
  const navigationPositions = {
    default: 'Default sidebar',
    left: 'Center left',
    right: 'Center right',
    top: 'Top center',
    bottom: 'Bottom center',
  };
  const fontRoles = {
    body: 'Body text',
    headings: 'Headings',
    buttons: 'Buttons',
    inputs: 'Inputs',
    navigation: 'Sidebar',
    gameTitles: 'Game titles',
    search: 'Search',
  };
  const presets = [
    {
      schemaVersion: 1,
      name: 'Dark',
      colors: {
        background: '#181818',
        foreground: '#202020',
        input: '#303030',
        icons: '#dedee3',
        text: '#eeeeee',
      },
      glass: { opacity: 0.88, blur: 22 },
    },
    {
      schemaVersion: 1,
      name: 'Light',
      colors: {
        background: '#eef0f4',
        foreground: '#ffffff',
        input: '#e0e5ee',
        icons: '#3e5bc7',
        text: '#222936',
      },
      glass: { opacity: 0.94, blur: 22 },
    },
    ...(typeof module !== 'undefined' && module.exports
      ? require('./default-theme-presets.js')
      : root.MambaBundledThemes || []),
  ];
  function parse(value) {
    if (!value || value.schemaVersion !== 1) throw Error('This is not a supported Mamba theme.');
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    if (!name || name.length > 60) throw Error('Theme names must be 1–60 characters.');
    const colors = {};
    for (const key of keys) {
      const color =
        value.colors?.[key] ??
        (key === 'supportingText'
          ? isLightBackground(value.colors?.background)
            ? '#222936'
            : '#eeeeee'
          : undefined);
      if (typeof color !== 'string' || !/^#[a-f0-9]{6}$/i.test(color))
        throw Error('Invalid ' + key + ' theme color.');
      colors[key] = color.toLowerCase();
    }
    const opacity = value.glass?.opacity,
      blur = value.glass?.blur;
    if (
      !Number.isFinite(opacity) ||
      opacity < 0 ||
      opacity > 1 ||
      !Number.isFinite(blur) ||
      blur < 0 ||
      blur > 40
    )
      throw Error('Invalid theme glassiness.');
    if (value.blurUnit !== undefined && !['percent', 'pixels'].includes(value.blurUnit))
      throw Error('Unsupported blur unit.');
    const referenceWidths = {
      background: 1440,
      foreground: 400,
      input: 240,
      icons: 24,
      text: 240,
      supportingText: 240,
    };
    const effects = {};
    for (const key of keys) {
      const defaults =
        key === 'background'
          ? { opacity: 0.36, blur: 14 }
          : ['foreground', 'input'].includes(key)
            ? { opacity, blur }
            : { opacity: 1, blur: 0 };
      const effect = value.effects?.[key] || defaults;
      if (
        !Number.isFinite(effect.opacity) ||
        effect.opacity < 0 ||
        effect.opacity > 1 ||
        !Number.isFinite(effect.blur) ||
        effect.blur < 0 ||
        effect.blur > (value.blurUnit === 'percent' || key === 'background' ? 100 : 40)
      )
        throw Error('Invalid ' + key + ' opacity or blur.');
      effects[key] = {
        opacity: effect.opacity,
        blur:
          value.blurUnit === 'percent'
            ? Math.min(
                key === 'background' ? 100 : 40,
                Math.round(effect.blur * referenceWidths[key]) / 100,
              )
            : effect.blur,
      };
    }
    const navigation = value.navigation ?? { position: 'default' };
    if (
      !navigation ||
      typeof navigation !== 'object' ||
      Array.isArray(navigation) ||
      !Object.hasOwn(navigationPositions, navigation.position)
    )
      throw Error('Invalid navigation position.');
    const result = {
      navigation: { position: navigation.position },
      schemaVersion: 1,
      name,
      colors,
      glass: { opacity, blur },
      effects,
      blurUnit: 'pixels',
    };
    if (value.fonts !== undefined) {
      if (!Array.isArray(value.fonts) || value.fonts.length > 8)
        throw Error('Use up to eight fonts.');
      let total = 0;
      const names = new Set();
      result.fonts = value.fonts.map((font) => {
        if (
          !font ||
          typeof font.name !== 'string' ||
          !font.name.trim() ||
          font.name.length > 100 ||
          names.has(font.name)
        )
          throw Error('Invalid font name.');
        names.add(font.name);
        if (
          typeof font.data !== 'string' ||
          font.data.length > 6990508 ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(font.data)
        )
          throw Error('Invalid font data.');
        const bytes = atob(font.data);
        total += bytes.length;
        if (total > 10485760) throw Error('Fonts must total 10 MB or less.');
        if (
          !['wOFF', 'wOF2', 'OTTO', 'true', String.fromCharCode(0, 1, 0, 0)].includes(
            bytes.slice(0, 4),
          )
        )
          throw Error('Use a TTF, OTF, WOFF, or WOFF2 font.');
        return { name: font.name, data: font.data };
      });
    }
    if (value.typography !== undefined) {
      result.typography = {};
      for (const role of Object.keys(fontRoles)) {
        const name = value.typography[role] || '';
        if (typeof name !== 'string' || (name && !result.fonts?.some((font) => font.name === name)))
          throw Error('Missing ' + role + ' font.');
        result.typography[role] = name;
      }
    }
    return result;
  }
  const isHex = (color) => typeof color === 'string' && /^#[a-f0-9]{6}$/i.test(color);
  const rgb = (color) => {
    const hex = isHex(color) ? color : '#181818';
    return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  };
  function mix(a, b, weight) {
    const left = rgb(a),
      right = rgb(b);
    return (
      '#' +
      left
        .map((value, index) =>
          Math.round(value * (1 - weight) + right[index] * weight)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
    );
  }
  function luminance(color) {
    return rgb(color)
      .map((v) => {
        v /= 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  }
  function isLightBackground(color) {
    return luminance(color) > 0.179;
  }
  function palette(value) {
    const theme = parse(value),
      c = theme.colors,
      light = isLightBackground(c.background),
      copy = c.supportingText;
    return {
      primary: c.background,
      sidebar: c.background,
      surface: c.foreground,
      input: c.input,
      inputInset: mix(c.foreground, c.background, 0.55),
      hover: mix(c.foreground, copy, 0.09),
      selection: c.input,
      focus: mix(c.input, copy, 0.12),
      text: copy,
      textSecondary: copy,
      textMuted: copy,
      textOnSelection: copy,
      button: c.input,
      buttonHover: mix(c.input, copy, 0.1),
      buttonText: copy,
      icons: c.icons,
      playButton: c.icons,
      danger: light ? '#a92f3b' : '#ef9a92',
      dangerHover: '#c42b36',
      success: light ? '#28763d' : '#a9df7c',
      ambientBlue: '#4285f4',
      ambientViolet: '#a78bfa',
      ambientPink: '#f68acb',
      ambientCyan: '#67e8f9',
    };
  }
  function fromPalette(value = {}) {
    const c = presets[0].colors;
    return parse({
      schemaVersion: 1,
      name: 'Custom',
      colors: {
        background: value.primary || c.background,
        foreground: value.surface || c.foreground,
        input: value.input || c.input,
        icons: value.icons || value.text || c.icons,
        text: value.text || c.text,
      },
      glass: { opacity: 0.88, blur: 22 },
    });
  }
  const glowOpacity = (foregroundOpacity, backgroundBlur) => {
    const opacity = Math.max(0, Math.min(1, Number(foregroundOpacity) || 0));
    const inverseBlur = 1 - Math.max(0, Math.min(100, Number(backgroundBlur) || 0)) / 100;
    return opacity * inverseBlur;
  };
  const api = {
    glowOpacity,
    fontRoles,
    navigationPositions,
    keys,
    presets,
    parse,
    palette,
    fromPalette,
    isLightBackground,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MambaThemes = api;
})(typeof window === 'undefined' ? globalThis : window);

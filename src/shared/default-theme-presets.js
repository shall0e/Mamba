(function (root) {
  const presets = [
    {
      schemaVersion: 1,
      name: 'Rose',
      colors: {
        background: '#2f1818',
        foreground: '#3e1e1e',
        input: '#502b2b',
        icons: '#ff8080',
        text: '#fe7676',
        supportingText: '#e4afaf',
      },
      glass: {
        opacity: 0.88,
        blur: 22,
      },
      effects: {
        background: {
          opacity: 0.79,
          blur: 35,
        },
        foreground: {
          opacity: 0.88,
          blur: 22,
        },
        input: {
          opacity: 0.88,
          blur: 22,
        },
        icons: {
          opacity: 1,
          blur: 0,
        },
        text: {
          opacity: 1,
          blur: 0,
        },
        supportingText: {
          opacity: 1,
          blur: 0,
        },
      },
      blurUnit: 'pixels',
    },
    {
      schemaVersion: 1,
      name: 'Mint',
      colors: {
        background: '#23433e',
        foreground: '#5a8d90',
        input: '#446f6c',
        icons: '#5cffce',
        text: '#80ffce',
        supportingText: '#cdfef8',
      },
      glass: {
        opacity: 0.88,
        blur: 22,
      },
      effects: {
        background: {
          opacity: 0.79,
          blur: 35,
        },
        foreground: {
          opacity: 0,
          blur: 40,
        },
        input: {
          opacity: 0.17,
          blur: 40,
        },
        icons: {
          opacity: 1,
          blur: 0,
        },
        text: {
          opacity: 1,
          blur: 0,
        },
        supportingText: {
          opacity: 1,
          blur: 0,
        },
      },
      blurUnit: 'pixels',
    },
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = presets;
  else root.MambaBundledThemes = presets;
})(typeof window === 'undefined' ? globalThis : window);

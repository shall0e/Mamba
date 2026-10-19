# Project preferences

- Use the supplied serpent logo in assets/mamba.png and assets/mamba.ico for Mamba branding, executable, installer, shortcuts, and notifications. Brand artwork is the exception to the Lucide action-icon rule.

- Use Lucide (https://lucide.dev) for every UI icon, including navigation, settings, window controls, actions, and empty states.
- Use official Lucide SVGs or the Lucide library. Do not substitute emoji, text glyphs, or custom-drawn icons.
- Bundle icons locally so they work offline with the application's Content Security Policy.
- Do not use visible outlines, borders, or focus rings on UI elements. Use darker background fills for separation and high contrast. Keep keyboard focus visible through background and text color changes.
- Keep the sidebar permanently collapsed with icons only, accessible button names, and hover labels at every window width.
- Keep the sidebar slim: 64px wide with 48px navigation buttons and 24px Lucide icons.
- Source all UI colors from the palette in config.json through CSS custom properties. Use palette-defaults.json for defaults. The selected sidebar item should use a lighter gray than the primary background.

- Do not publish releases, create/push release tags, or dispatch release workflows unless the user explicitly requests publishing. Version bumps and local builds do not authorize publishing.

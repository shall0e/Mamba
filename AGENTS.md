# Project preferences

- Use the supplied serpent logo in assets/mamba.png and assets/mamba.ico for Mamba branding, executable, installer, shortcuts, and notifications. Brand artwork is the exception to the Lucide action-icon rule.

- Use Lucide (https://lucide.dev) for every UI icon, including navigation, settings, window controls, actions, and empty states.
- Use official Lucide SVGs or the Lucide library. Do not substitute emoji, text glyphs, or custom-drawn icons.
- Bundle icons locally so they work offline with the application's Content Security Policy.
- Do not use visible outlines, borders, or focus rings on UI elements. Use darker background fills for separation and high contrast. Keep keyboard focus visible through background and text color changes.
- Keep the sidebar permanently collapsed with icons only, accessible button names, and hover labels at every window width.
- Keep the sidebar slim: 64px wide with 48px navigation buttons and 24px Lucide icons.
- Source all UI colors from the palette in config.json through CSS custom properties. Use palette-defaults.json for defaults. The selected sidebar item uses the Input theme role with clear contrast against Background.

## Theme-aware design

- Always design new and changed UI around the five user-facing theme roles: Background (page background and artwork tint), Foreground (cards and panels), Input (input fields, selected controls, and download buttons), Icons (icons and Play buttons), and Text (all text). Preserve the chosen Text and Icons hue and saturation while smoothly adapting lightness to the composited background under each element; never recolor the Foreground or Background surfaces.
- Use theme-model.js to derive the palette and the shared CSS variables. Never introduce independent hardcoded UI colors or additional appearance color controls.
- Honor independent opacity and blur for each of the five color roles. Preserve readable text and clear interaction states in Dark, Light, and custom themes.
- Appearance uses a simple list of color sections on the left. Clicking a section shows only its color, opacity, and blur in the editor on the right; Fonts uses the same editor. Do not display every section’s sliders at once. Theme files include embedded custom fonts and separate font assignments for body text, headings, buttons, and inputs. They contain appearance only, never account keys, source URLs, paths, or other settings.
- Keep the original search slideshow and glow, transparent icon sidebar with its fading separator, and clean, direct labels. Do not add promotional taglines or duplicate search/navigation controls.
- Use restrained spring/ease motion for interactions and honor reduced-motion preferences.

- Do not publish releases, create/push release tags, or dispatch release workflows unless the user explicitly requests publishing. Version bumps and local builds do not authorize publishing.

- Use the app-owned rounded scrollbar with Foreground opacity and blur, using the Icons theme color with its hue and saturation preserved during adaptive lightness changes. The fading sidebar divider follows the same adaptive Icons color. Style range sliders with the theme rather than browser-default visuals. Do not expose browser-native scrollbars.

- Background blur spans 0–100 and sets glow opacity to Foreground opacity multiplied by (1 minus Background blur/100), so either zero Foreground opacity or maximum Background blur fully hides the glow.

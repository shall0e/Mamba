# Project preferences

- Use the supplied serpent logo in assets/mamba.png and assets/mamba.ico for Mamba branding, executable, installer, shortcuts, and notifications. Brand artwork is the exception to the Lucide action-icon rule.

- Use Lucide (https://lucide.dev) for every UI icon, including navigation, settings, window controls, actions, and empty states.
- Use official Lucide SVGs or the Lucide library. Do not substitute emoji, text glyphs, or custom-drawn icons.
- Bundle icons locally so they work offline with the application's Content Security Policy.
- Use subtle 1px separators derived from the theme Icons role, as requested by the redesign brief. Keep keyboard focus visible through background changes and an inset theme-colored marker; do not use browser-default outlines.
- Default to a permanently visible labeled desktop sidebar, 192px at normal desktop widths (180–200px target), with 20px Lucide icons and 44px navigation targets. Include the unified Recently Played list, including its temporary newest-install entry. Do not render a hide/collapse button or honor legacy collapsed state.
- Source all UI colors from the palette in config.json through CSS custom properties. Use src/shared/palette-defaults.json for defaults. The selected sidebar item uses the Input theme role with clear contrast against Background.

## Theme-aware design

- Always design new and changed UI around the five user-facing theme roles: Background (page background and artwork tint), Foreground (cards and panels), Input (input fields, selected controls, and download buttons), Icons (icons and Play buttons), and Text (all text). Preserve the chosen Text and Icons hue and saturation while smoothly adapting lightness to the composited background under each element; never recolor the Foreground or Background surfaces.
- Use src/shared/theme-model.js to derive the palette and the shared CSS variables. Never introduce independent hardcoded UI colors or additional appearance color controls.
- Honor independent opacity and blur for each of the five color roles. Preserve readable text and clear interaction states in Dark, Light, and custom themes.
- Appearance uses a simple list of color sections on the left. Clicking a section shows only its color, opacity, and blur in the editor on the right; Fonts uses the same editor. Do not display every section’s sliders at once. Theme files include embedded custom fonts and separate font assignments for body text, headings, buttons, and inputs. They contain appearance only, never account keys, source URLs, paths, or other settings.
- Keep the original search slideshow and glow, transparent icon sidebar with its fading separator, and clean, direct labels. Do not add promotional taglines or duplicate search/navigation controls.
- Use restrained spring/ease motion for interactions and honor reduced-motion preferences.

- Do not publish releases, create/push release tags, or dispatch release workflows unless the user explicitly requests publishing. Version bumps and local builds do not authorize publishing.

- Always keep the local build and GitHub build in sync: use the same source commit, version, dependencies, bundled assets, and build configuration. When changes are merged or a release is published, update and rebuild the local copy to match the GitHub build. Verify that both builds contain the same changes; do not leave a stale local build or local-only build changes. This requirement does not authorize publishing a release without an explicit request.

- Use the app-owned rounded scrollbar with Foreground opacity and blur, using the Icons theme color with its hue and saturation preserved during adaptive lightness changes. The fading sidebar divider follows the same adaptive Icons color. Style range sliders with the theme rather than browser-default visuals. Do not expose browser-native scrollbars.

- Background blur spans 0–100 and sets glow opacity to Foreground opacity multiplied by (1 minus Background blur/100), so either zero Foreground opacity or maximum Background blur fully hides the glow.

## Design Language

- Library card grids use at most five columns, reducing columns at smaller widths while
  preserving natural artwork ratios. Ordinary controls and labels use stable 150ms color,
  background and opacity transitions without moving/scaling on hover or press. Reduce
  ambient glow outside Home using page atmosphere; preserve appearance-role zero endpoints.

### Fourth-pass interaction and typography standards

- Use bundled TT Interphases Pro Regular (400) and Bold (700) for UI hierarchy; these are
  the two supplied interface weights. Keep Coolvetica Regular (400) for the Mamba wordmark.
  Do not synthesize unavailable weights. Preserve explicit custom theme font assignments.
- Brand composition uses the theme-aware masked serpent at 32px next to the wordmark and
  regular-weight version label. Home shows only a centered 144px themed serpent above search.
- Library preferences are permanently laid out below the toolbar, never an expanding menu.
  Library and Search card artwork keeps its natural ratio without clipping, hover zoom or
  reserved fallback space once loaded. Play actions use the Icons role as their surface;
  adapt Text-role lightness for contrast while preserving its hue and saturation.
- Sidebar recent-game shortcuts use shared cached artwork at 34px. Titles and row space
  open details; thumbnail buttons launch installed executable games through the existing
  handler, otherwise open details. Both actions must be independently keyboard accessible.
  Right-click and Shift+F10 use the shared game menu. Truncate titles with full-name labels.
  Report running only from confirmed process state; external launcher lifetimes are unknown.
- Use one Recently Played list, sized to available sidebar height. Pin only the newest
  installation while it has not been played after installation; a later install replaces
  this temporary entry. Once played, it remains in normal last-played order. Never show a
  second Recently Installed section or resurrect older unplayed installs as pending entries.
  Keep Settings anchored below the list; resizing must not duplicate artwork requests.
- Game details artwork is the front-and-center focal point: a centered image up to 900px
  wide at its natural aspect ratio, with aligned title/metadata/actions below it. Do not
  restore the small side thumbnail layout on desktop windows.
- All artwork consumers use MambaArtwork's shared request cache. Preserve missing-artwork
  fallbacks, retry failed loads, and do not create duplicate per-component requests.
- Play surfaces use Icons with adaptive Text contrast; Download surfaces use Input. Card and
  release actions are compact; the details primary action is 44px and visually stronger.
- Details uses an open, unboxed cinematic hero over edge-to-edge faded artwork. Its neutral
  canvas derives lightness from the Background role; the artwork remains a restrained accent,
  rather than a page-wide saturated tint. Keep Back visible and header artwork uncropped.
  Use the naturally heavy Coolvetica Regular face for the large game title; do not synthesize
  an unavailable Coolvetica Bold face. Settings headings, labels and disclosure titles use the
  supplied real TT Interphases Bold 700 and stay bold during interaction.
- Show one primary action plus accessible icon-only Favorite/Open Folder/Uninstall actions.
  Organize Overview, Installation, Additional Content (when known), and Available Downloads
  with compact dividers. Put all setup, administrator and launcher/integration controls inside
  a closed Manage Installation disclosure. Downloads remain visible with integrated filters.
- Release rows separate title, known source/host/size/version, availability, service and
  action. Only mark a release Recommended when the resolver selected an available full
  compatible release. Keep service/source/name filtering, explicit sorting and progressive
  loading. Never invent sizes, release metadata or source reliability.
- Validate shortcut details/launch/menu actions, artwork deduplication, actual font faces,
  long titles, missing artwork, release states, keyboard/pointer input and scaled layouts
  before rebuilding the local application. Preserve downloads and source integration.

Mamba is a restrained, precise desktop launcher. Follow [the design specification](docs/design-language.md)
and reuse existing components before creating alternatives. `src/renderer/styles/design-system.css`
is the final shared visual authority; `app.css` retains structural and theme behavior.

- Use the shared 4/8/12/16/24/32/48px spacing scale, 6px control and 8px panel radii, and
  11/12/14/16/20/28px typography scale. Preserve custom font assignments. Circles for
  toggles/progress, serpent branding, and artwork masks are intentional exceptions.
- Keep navigation labels permanently visible by default, Settings at the bottom, and explicit
  collapse/expand controls. Preserve saved placement and collapsed preferences. Use the Input
  role for active states. Keep semantic buttons, accessible names, aria-current, visible keyboard
  focus and stationary hover feedback. Collapsed navigation retains named tooltips.
- Source colors/effects from the existing theme model. Preserve custom colors, independent
  opacity/blur, adaptive contrast, theme files and embedded fonts. Add no competing color system.
- Artwork presets are Subtle, Balanced (legacy default), Immersive. Page treatments vary
  artwork visibility; they must not recolor Foreground/Background or break the glow formula.
- Controls use 140ms transitions (navigation must stay within 120–160ms); artwork crossfades and startup handoff are documented
  exceptions. Honor reduced motion. Keep primary actions visible without hovering.
- Prohibit excessive pills, decorative shadows, promotional taglines, arbitrary gradients,
  gratuitous glass effects and generic dashboard decoration. Existing artwork glow is intentional.
- Use 14px body text, 12–13px supporting text, 18–20px section headings and 26–30px page
  headings. Inputs/actions generally measure 36–40px. TT Interphases supplies real regular/bold
  interface weights, Coolvetica is reserved for branding, and custom theme font assignments stay available.
- Settings uses a measured workspace: at 1700px, approximately 1100–1300px total, 170–200px
  category navigation and 750–950px content. Reflow category navigation before squeezing
  controls. Manage folders as accessible Add/Change/Remove rows, never raw multiline text.
  Group related settings without nested cards, show credential status, and collapse rare options.
- **Never prioritize visual compactness over legibility, accessibility, or efficient use of available screen space.**
  Every future UI implementation must be checked at realistic desktop dimensions before being
  considered complete. Inspect zoom, DPR, transforms and constraints before compensating with
  styling. Verify actual rendered windows at 1700×900, 1280×720 and 1920×1080, including
  125%/150% DPI. Distinguish renderer DPI testing from physical Windows scaling changes.

Mandatory acceptance for future UI changes: no clipped/overlapping controls or horizontal
overflow; at least 95% spacing on the scale; all reusable primitives use tokens; normal text
4.5:1 and large text 3:1 contrast; visible keyboard focus and accessible names; readable at
100/125/150% scaling; functional at 1280×720, 1920×1080 and 2560×1440. Check all impacted
major/secondary screens, five varied artworks, built-in/custom themes and presets, persistence,
empty/loading/error/disabled/long-content states and before/after screenshots. Preserve shortcuts,
search/filter/sort behavior, downloads and integrations. Existing tests must pass unchanged in
intent. Median interaction latency must not regress over 10% under equivalent conditions.
For substantial changes follow the audit → tokens → shell → screens → artwork → interactions
→ QA → documentation sequence in the redesign brief. Document intentional exceptions and
report each relevant acceptance category as passed, failed or unverified; never infer completion
from screenshots alone.

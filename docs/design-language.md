# Mamba design specification

## Audit and component inventory

The renderer uses static HTML plus small imperative controllers. `app.css` has accumulated
multiple generations of component overrides. Keep the existing DOM identifiers, event
handlers, local SVGs, custom scrollbar, and theme contrast engine. Consolidate geometry
through shared tokens and make `design-system.css` the final visual authority.

| Area          | Treatment                                                                       |
| ------------- | ------------------------------------------------------------------------------- |
| Shell         | 192px labeled sidebar, optional persisted collapse, recent-game quick launches  |
| Home          | Horizontal serpent wordmark, compact search stage, original slideshow and glow  |
| Library       | 16:9 artwork, persistent actions, aligned metadata, responsive dense grid       |
| Search        | Compact search header, aligned filter strip, consistent result grid and actions |
| Settings      | Category rail, section heading and description, aligned setting rows            |
| Details       | Artwork and title/action split, readable description column, grouped versions   |
| Activity      | Compact transfer rows, tabular metrics, shared cards and progress controls      |
| Dialogs/menus | Shared surface, 8px corners, consistent action strip and focus feedback         |
| Appearance    | Preserve section/editor model, fonts, role effects and import/export            |

## Rules

Use the existing theme model for every color. Foreground and Input retain their selected
hue, opacity and blur. Text and icon adaptation stays with the existing contrast engine.
Subtle separators derive from the Icons role; no new color picker is introduced.
Controls use 6px corners, panels 8px; circles are reserved for toggles, avatars and progress.
Typography uses 14px body text, 12–13px supporting text, 18–20px section headings and
28px page headings. Spacing uses a 4px scale. The supplied TT Interphases Regular/Bold
faces provide real 400/700 UI weights; Coolvetica Regular is reserved for the wordmark.
Preserve imported font assignments and disable synthetic weights.

Background intensity is appearance-only and round-trips in theme files. Balanced is the
fallback for older themes. Intensity and page atmosphere multiply artwork visibility,
without modifying the user's Background or Foreground colors/effects. The glow remains
Foreground opacity × (1 − Background blur/100), including its exact zero endpoints.
Artwork crossfades are the deliberate exception to 140ms control motion. Reduced motion
disables transitions and drift. Failed images leave the neutral theme surface intact.

Navigation labels are always visible by default: 192px sidebar, 20px icons, 44px targets.
Settings is bottom-anchored. A deliberate 56px collapsed mode persists as a boolean user
preference, separately from appearance. Keep saved horizontal placement options available.
Recently Played and Recently Installed show up to three dated entries each, including
uninstalled entries when known. Shared cached artwork appears in 34px launch buttons;
titles open details. Uninstalled thumbnail actions open details. Right-click/Shift+F10
opens the shared game menu. Native process state is reported only while tracked.
Shared inputs/actions are 38–40px tall. Tooltips remain available when collapsed.

Settings uses a 1168px workspace at 1700px: 188px categories, 32px gutter, 948px content.
Related controls are grouped structurally; folder management uses Add/Change/Remove rows
and native directory selection. Advanced download options use disclosure, services expose
credential state, and section navigation reflows into a wrapped row below 900px. Appearance
keeps its independent section/editor layout with a measured 240px role column.

**Never prioritize visual compactness over legibility, accessibility, or efficient use of
available screen space.** Diagnose zoom, root type, DPR and constraints before adjusting
styling. Every UI change requires realistic rendered desktop checks.

## Verification checklist

Review Home, Library, Search, Settings, Details, Activity and dialogs at matching sizes.
Include empty/loading/error/disabled and long-content cases, keyboard focus, minimum
window size and 100/125/150% scaling. Check built-in themes, custom fonts, theme file
round-trips, and five bright/dark/saturated/high-contrast artworks. Normal text must meet
4.5:1 contrast (large text 3:1). No horizontal overflow or clipped controls is acceptable.
Keep actions discoverable without hover. Measure median interaction latency on equivalent
fixtures: no regression above 10%. Run existing regression tests without weakening them.
Unmeasured criteria remain unverified, even when static screenshots look correct.

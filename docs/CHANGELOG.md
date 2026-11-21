# Changelog

## Unreleased

- Theme layout engine: themes can now arrange components (variant, which parts show and in what order) and set bounded shape and spacing tokens, falling back to the original design. Search result cards, the results grid, Library cards, the game details page (section order, width, spacing) and its header (Centered or Split), the sidebar (width, button and icon size, icon-only style, page order and where Recently Played sits), and the Activity page (section order and stacked or side-by-side overview cards) are built this way. Edit them in Settings → Appearance → Layout or in the theme file; see docs/theming.md.
- Search result cards: removed the repeated release year and trademark symbols from titles, unified the year, size and service text, kept the action button visible and aligned at the bottom of every card, and added Overlay and Row variants.
- Fixed settings controls that should stay disabled being re-enabled whenever settings finished saving.

- Game details show Steam screenshots and trailers in a carousel with a thumbnail strip, arrow-key navigation and a full-size screenshot viewer (previous/next, Esc or click outside to close).
- Download buttons show live progress (for example "Downloading · 42%") on Home, search results, game details and release rows.
- Available Downloads opens automatically for games that are not installed and shows how many versions were found; installed games keep it collapsed.
- Optional keyboard shortcuts: Ctrl+1/2/3 for Home/Library/Activity, Ctrl+, for Settings, Ctrl+F to find, and Esc, Alt+← or the mouse Back button to leave game details. A reference card lives in Settings → App.
- Mamba remembers its window size, position and maximized state, and moves the window back on-screen if a monitor is disconnected.
- Fixed game details where a finished download relabeled the Uninstall or Favorite button and hid Install.
- Fixed the "ready to play" toast being replaced before its Play action could be used; failures and setup reviews now offer a direct action.
- Fixed game title matching for en/em dashes and curly apostrophes, which were stored as corrupted characters.
- Fixed a shared artwork cache entry keeping one caller's fallback image for every other caller, and failed artwork now falls back to the Steam cover.
- Toasts stay readable longer for long messages and pause while hovered or focused; retry countdowns no longer show "undefined".
- Sidebar Recently Played no longer rebuilds on every resize frame; download-row updates avoid repeated DOM scans.
- Hardened the window: navigation away from the app and pop-up windows are blocked, only video fullscreen permission is granted, IPC game actions are validated, and stray main-process errors are logged with secrets redacted.
- Cached Steam details survive offline refreshes, and Activity shows readable source states.

## 1.6.2

- Consolidated Library search, filters, sorting, Favorites and grid/list switching into one toolbar, with detection and Steam controls in Manage.
- Made Library cards open game details, removed card Play/Favorite buttons, and fixed hover/focus title overlays.
- Prefer standard Steam library artwork with cached, offline-safe fallbacks, including games with saved embedded artwork.
- Attached game titles and primary actions to the detail hero, aligned metadata and sections, improved readability, and simplified installation management.
- Improved search progress, two-character minimum queries, filter labels, source information, metadata chips and compact download actions.
- Fixed progressive search and pagination races, stale Steam connection status, and list-view clipping.
- Recently Played fills the available window height without a fixed entry cap or View all control.

Validation: 228 automated tests pass; two Linux-only tests are skipped on Windows. Electron desktop checks pass at 100%, 125% and 150% renderer scaling. Physical Windows scaling was not changed.

## 1.4.3

- Discover installed games across drives, extra game folders, launcher manifests, and registered installations while preserving the main installation destination.
- Integrate the signed-in local Steam library, hide unknown games by default, and exclude software and runtimes.
- Improve game identity and artwork matching, group DLC under its base game, and distinguish Minecraft editions.
- Add card, compact list, and banner layouts, library options, favorites filtering, and installed-first sorting.
- Refine game details, full-width artwork cards, library controls, folder settings, and setup-helper prompts.
- Require uninstalling installed copies before removing a game from the library.
- Add themed confirmations, native Xbox uninstall routing, and optional administrator retry after permission failures.

## 0.2.1

- Fix ordinary RAR archives being rejected when 7-Zip reports empty link metadata. Actual links and unsafe paths remain blocked.

## 0.2.0

- Windows installer with GitHub automatic updates, version display, manual update checks, and restart-to-install controls.
- Complete JSON configuration import/export, validation and automatic pre-import backups.
- Settings for archive retention, TorBox preparation timeout, automatic updates and the shared color palette.
- Consistent buttons, spacing, cards and transfer rows; library game artwork.
- Universal per-game setup command with startup-file and folder browsing, automatic post-install setup, and Steam/Xbox PC registration.

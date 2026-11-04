# Changelog

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

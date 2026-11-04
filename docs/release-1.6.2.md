# Mamba 1.6.2

- Consolidated Library search, filters, sorting, Favorites and grid/list switching into one toolbar, with detection and Steam controls in Manage.
- Made Library cards open game details, removed card Play/Favorite buttons, and fixed hover/focus title overlays.
- Prefer standard Steam library artwork with cached, offline-safe fallbacks, including games with saved embedded artwork.
- Attached game titles and primary actions to the detail hero, aligned metadata and sections, improved readability, and simplified installation management.
- Improved search progress, two-character minimum queries, filter labels, source information, metadata chips and compact download actions.
- Fixed progressive search and pagination races, stale Steam connection status, and list-view clipping.
- Recently Played fills the available window height without a fixed entry cap or View all control.

Validation: 228 automated tests pass; two Linux-only tests are skipped on Windows. Electron desktop checks pass at 100%, 125% and 150% renderer scaling. Physical Windows scaling was not changed.

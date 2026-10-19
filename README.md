# Mamba

Double-click `START.vbs` to open Mamba without a terminal window, or create a
Windows app with `npm run build`.

Settings saves to `config.json`. The local build in `dist/win-unpacked` shares
the project configuration and catalog. Moving the app elsewhere uses its own
Windows app-data folder. API keys are plain text and are never bundled into
the app package.

- `sourceUrls`: Hydra-compatible JSON feeds. Saving or editing this list rebuilds
  `catalog.json`, including duplicate counts and unavailable-source errors.
- `torboxApiKey`: your TorBox key.
- `downloadPath`: parent folder for games and temporary downloads.
- `cachedOnly`: defaults to `true`; search includes only TorBox-confirmed cached
  links. Set to `false` to also allow torrents and available supported web hosts.
- `autoInstall`: automatically runs recognized Inno Setup/NSIS installers.
  Other installers show **Setup required**. Portable games are detected directly.
- `archivePassword`: optional password for archives.
- `keepArchives`: optional; set `true` to retain temporary downloads after success.
- `transferTimeoutMinutes`: TorBox preparation timeout, default `120`.
- `palette`: UI colors.

Choose a release in Search to queue a TorBox download. Library shows progress,
cancel/retry controls, installed games, Play, and Open Folder. Interrupted
downloads can be resumed with Retry. Archives are extracted with bundled
7-Zip; wrapper folders are removed while internal game directories are retained.
Completed downloads are registered automatically. Library's Refresh also scans
existing game folders under `downloadPath`.

Source failures and TorBox rate limits appear in Settings. Availability checks
are cached for an hour, and rate-limited syncs resume while the app remains open.
Links are checked again by TorBox when a download is created because cache
availability can change.

## Development

Install Node.js 22+, then run `npm ci`. Double-click `START.vbs` to launch without
a terminal; `START.cmd` forwards to the same launcher. `npm run build` produces `dist/win-unpacked`.
GitHub Actions builds a Windows download on pushes to main and manual runs.

Search uses Steam's public store search endpoint for official game names and
header artwork, without an API key. Matches preserve numbered sequels and
remasters. Duplicate releases share one card and keep their download options.
Metadata is cached locally in `game-metadata.json`; artwork is cached in `artwork/`.
Unavailable or ambiguous matches retain their cleaned source title and fallback icon.

`config.example.json` is a key-free example. Configure your own API key, sources,
and download folder in Settings. Personal configuration, downloaded content,
source catalogs, and caches are excluded from Git and packaged builds.

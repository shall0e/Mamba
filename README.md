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

## Installation cleanup and shortcuts

After installation, Mamba lifts archive wrappers out of the game root and names
its folder after the matched Steam title (with Windows-invalid characters
replaced). Existing destination folders are preserved. Internal engine folders
such as Binaries/Win64 and Engine remain intact. A single start/launch script
is preferred when supplied by the game. Locked folders stay pending and retry
while Mamba is open, or after restarting it.

Double-click `ADD-GAME.cmd` in the project or beside the built application if a
launcher or root needs manual selection. Enter a game folder or launcher path,
select the actual game root, and confirm the name. It repairs the folder, saves
the chosen launcher, creates a desktop shortcut, and registers a non-Steam game.
EXE, COM, BAT, CMD, PS1, and Windows shortcuts are supported.

New installations automatically register in the most recently active Steam
account. If Steam is running, Mamba requests a normal shutdown, saves the shortcut,
and reopens Steam automatically. Existing identical shortcuts do not trigger a
restart. If Steam refuses to close within 45 seconds, registration stays pending
and reports the failure. Existing shortcuts are preserved and backed up.
This adds a non-Steam shortcut; it does not grant a Steam license.

## Xbox PC library

New installations and ADD-GAME.cmd also register the selected launcher in the
Xbox PC app's custom library. Existing Mamba installations are imported on
startup and Library refresh. EXE launchers are added directly; scripts use their
Windows interpreter and arguments. Available cached artwork is copied locally.

Registration uses the Xbox app's local CustomLibraryManagement.manifest format,
which is not a published Microsoft API. Existing entries are preserved and backed
up, and an unknown format is rejected without replacing it. Open/update Xbox
once if its custom-library folder is missing. Reopen Xbox to refresh its tiles
after registration if necessary. This adds a local PC launcher entry, with no
Xbox license or achievement entitlement.

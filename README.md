<div align="center">

<img src="assets/mamba.png" alt="Mamba logo" width="192">

# Mamba Launcher

<p><a href="https://github.com/shall0e/Mamba/releases/latest"><img src="https://img.shields.io/github/v/release/shall0e/Mamba?style=flat-square&label=release&labelColor=202020&color=5cffce" alt="GitHub Release"></a>
<a href="https://github.com/shall0e/Mamba/releases"><img src="https://img.shields.io/github/downloads/shall0e/Mamba/total?style=flat-square&label=downloads&labelColor=202020&color=5cffce" alt="GitHub Downloads (all assets, all releases)"></a>
<a href="https://github.com/shall0e/Mamba/stargazers"><img src="https://img.shields.io/github/stars/shall0e/Mamba?style=flat-square&label=stars&labelColor=202020&color=5cffce" alt="GitHub Repo stars"></a>
<a href="https://github.com/shall0e/Mamba/issues"><img src="https://img.shields.io/github/issues/shall0e/Mamba?style=flat-square&label=issues&labelColor=202020&color=5cffce" alt="GitHub Issues"></a></p>

**[Screenshots](#screenshots) &nbsp; · &nbsp; [Features](#features) &nbsp; · &nbsp; [Mamba vs. Hydra](#mamba-vs-hydra) &nbsp; · &nbsp; [Development](#development)**

</div>

<p align="center"><img src="assets/readme/divider.svg" width="100%" height="8" alt=""></p>

## What if Hydra's heads never grew back?

**Mamba Launcher** is a lightweight usage-focused Windows game downloader inspired by [Hydra Launcher](https://github.com/hydralauncher/hydra).

While Hydra aims to be an all-in-one gaming platform, Mamba takes a different approach: **actually downloading the games**

<p align="center"><img src="assets/readme/divider.svg" width="100%" height="8" alt=""></p>

## Screenshots

<table>
<tr><th align="left" width="50%">Home</th><th align="left" width="50%">Library</th></tr>
<tr><td><a href="assets/screenshots/home.png"><img src="assets/screenshots/home.png" alt="Mamba home" width="540"></a></td><td><a href="assets/screenshots/library.png"><img src="assets/screenshots/library.png" alt="Mamba game library" width="540"></a></td></tr>
<tr><th align="left" width="50%">Search</th><th align="left" width="50%">Activity</th></tr>
<tr><td><a href="assets/screenshots/search.png"><img src="assets/screenshots/search.png" alt="Mamba game search" width="540"></a></td><td><a href="assets/screenshots/activity.png"><img src="assets/screenshots/activity.png" alt="Mamba activity dashboard" width="540"></a></td></tr>
</table>

<p align="center"><img src="assets/readme/divider.svg" width="100%" height="8" alt=""></p>

## Features

<table>
<tr>
<td valign="top" width="33%">
<h3>Game Discovery</h3>
<ul>
<li><strong>Extensive game catalog</strong> - Bring all of your Hydra links over, Mamba sorts through the garbage.</li>
<li><strong>One-click downloads</strong> - Just search and hit download.</li>
<li><strong>Centralized interface</strong> - Discover available downloads from one application.</li>
</ul>
</td>
<td valign="top" width="33%">
<h3>Download Management</h3>
<ul>
<li><strong>Download progress tracking</strong> - Monitor active downloads and their progress.</li>
<li><strong>Download history</strong> - Keep track of download activity.</li>
<li><strong>Download diagnostics</strong> - Collect troubleshooting information when downloads fail.</li>
</ul>
</td>
<td valign="top" width="33%">
<h3>Desktop Experience</h3>
<ul>
<li><strong>Minimalist interface</strong> - Designed around simplicity rather than extensive navigation.</li>
<li><strong>Lightweight workflow</strong> - Avoid the complexity of managing an entire gaming library.</li>
<li><strong>Focused functionality</strong> - Download games without distractions or unnecessary extras.</li>
<li><strong>Customizability</strong> - Make it yours and express yourself through color!</li>
</ul>
</td>
</tr>
</table>

<p align="center"><img src="assets/readme/divider.svg" width="100%" height="8" alt=""></p>

## Mamba vs. Hydra

| Feature                    | Mamba | [Hydra](https://github.com/hydralauncher/hydra) |
| -------------------------- | :---: | :---------------------------------------------: |
| Game library               |  ✅   |                       ✅                        |
| Game discovery             |  ✅   |                       ✅                        |
| One-click downloads        |  ✅   |                       ❌                        |
| Dead link removal          |  ✅   |                       ❌                        |
| Automatic unnesting        |  ✅   |                       ❌                        |
| Adding to Steam Library    |  ✅   |                       ❌                        |
| Automatic best source      |  ✅   |                       ❌                        |
| Download history           |  ✅   |                       ✅                        |
| Accurate download progress |  ✅   |                       ❌                        |
| Accounts                   |  ❌   |                       ✅                        |
| Friends                    |  ❌   |                       ✅                        |
| Cloud saves                |  ❌   |                       ✅                        |
| Achievements               |  ❌   |                       ✅                        |
| Subscription service       |  ❌   |                       ✅                        |

<p align="center"><img src="assets/readme/divider.svg" width="100%" height="8" alt=""></p>

## Development

Run `npm ci` then `npm start`. On Windows, `START.cmd` launches without a terminal.

- `npm run build`: create a local unpacked app.
- `npm run release:win`: build an installer without publishing.
- `npm run format` / `npm run format:check`: format source / check formatting.

CreamInstaller is bundled as a separate executable from [FroggMaster/CreamInstaller](https://github.com/FroggMaster/CreamInstaller). Open it from Settings → App or a game's advanced installation controls. With Automatic updates enabled, Mamba checks its stable releases once daily and verifies downloads before switching versions. The bundled copy works offline; failed updates leave the current copy available.

Local and GitHub builds use the version and SHA-256 recorded in `src/shared/cream-installer-release.json`. The build hook downloads that executable once into the ignored `vendor/creaminstaller` cache. Its GPL v3 license and corresponding-source link are included in the packaged `creaminstaller` resources. Release publication uses the manually dispatched GitHub release workflow.

<details>
<summary><strong>Project layout</strong></summary>

| Folder         | Contents                                                     |
| -------------- | ------------------------------------------------------------ |
| `src/main`     | Electron entry, preload, worker entry, OS integration        |
| `src/core`     | Catalog, downloads, installation, service clients            |
| `src/renderer` | Pages, UI scripts, stylesheet                                |
| `src/shared`   | Theme model, presets, shared utilities                       |
| `assets`       | Branding, screenshots, Lucide license                        |
| `tools`        | Game setup helper and Windows launch scripts                 |
| `config`       | Example configuration                                        |
| `test`         | Automated checks                                             |
| `data`         | Local configuration and caches, excluded from Git and builds |
| `dist`         | Generated builds, excluded from Git                          |

Development data previously stored in the project root is moved to `data/` automatically. Installed apps continue using their existing user data directory.

</details>

## MambaCLI

Requires Node.js 22 or newer. From the checkout, run `node tools/mamba-cli.cjs -help`.
Add the checkout's `tools` directory to your user PATH to run `mamba -help`
from Windows Command Prompt or PowerShell. On Linux, make `tools/mamba` executable
with `chmod +x tools/mamba`, then add that directory to PATH.

Commands: `mamba search <words>`, `mamba download <release-id>`, and `mamba jobs`.
Configure sources, account keys and the Games folder in Mamba first. Set
`MAMBA_DATA_DIR` to the directory containing config.json if using an installed copy.
The CLI stores its queue under that directory's `cli` subdirectory. Downloads run
in the foreground; keep the terminal open until completion. Linux can download
Windows game releases; Windows installers and integrations require Windows.

## MegaSource

The combined source is generated from `config/mega-sources.json` on GitHub every
six hours. Add or remove public source URLs in that file to change its contents.
The job fails without replacing the previous publication if an upstream source
cannot be downloaded or parsed.

Add this URL in Mamba Settings → Sources:

https://github.com/shall0e/Mamba/releases/download/megasource/megasource.json

Use the combined URL instead of its individual component sources to avoid
redundant downloads. Run `node tools/build-megasource.cjs` to generate it locally.
Only public URLs belong in the tracked source list; never add account keys.

## Linux builds

GitHub's build workflow produces x64 AppImage and Debian packages alongside the
Windows build. Download them from the workflow's Mamba-Linux artifact. Locally,
run `npm ci` then `npm run build:linux` on Linux. Install system `7z` for archive
extraction. Windows-only helper and integration features are unavailable on Linux.

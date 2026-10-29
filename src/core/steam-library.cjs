const fs = require('node:fs/promises');
const path = require('node:path');
const { isNonGame } = require('./game-identity.cjs');
function parseTextVdf(text) {
  const tokens = String(text).match(/"(?:\\.|[^"\\])*"|[{}]/g) || [];
  let cursor = 0;
  const scalar = (value) => value.slice(1, -1).replace(/\\([\\"])/g, '$1');
  function object(depth = 0) {
    if (depth > 40) throw Error('Invalid Steam configuration.');
    const result = Object.create(null);
    while (cursor < tokens.length) {
      const key = tokens[cursor++];
      if (key === '}') return result;
      const value = tokens[cursor++];
      if (!key?.startsWith('"') || !value) break;
      result[scalar(key)] = value === '{' ? object(depth + 1) : scalar(value);
    }
    return result;
  }
  return object();
}
class SteamLibrary {
  constructor(identity, { profile = require('./shortcuts.cjs').steamProfile } = {}) {
    this.identity = identity;
    this.profile = profile;
    this.state = {
      connected: false,
      message: 'Sign into the Steam desktop app to connect your library.',
    };
    this.games = [];
    this.at = 0;
  }
  read() {
    if (this.pending) return this.pending;
    this.pending = this.readNow().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  async readNow() {
    try {
      const shortcutFile = await this.profile();
      const cached = this.profileFile === shortcutFile && Date.now() - this.at < 5 * 60000;
      if (this.profileFile !== shortcutFile) this.games = [];
      this.profileFile = shortcutFile;
      if (!cached) this.at = Date.now();
      const config = path.dirname(shortcutFile);
      const accountId = path.basename(path.dirname(config));
      if (!/^\d+$/.test(accountId)) throw Error('Steam account unavailable.');
      const steamId = String(76561197960265728n + BigInt(accountId));
      const root = path.resolve(config, '..', '..', '..');
      const users =
        parseTextVdf(
          await fs.readFile(path.join(root, 'config', 'loginusers.vdf'), 'utf8').catch(() => ''),
        ).users || {};
      const accountName =
        users[steamId]?.PersonaName || users[steamId]?.AccountName || 'Steam account';
      const local = parseTextVdf(
        await fs.readFile(path.join(config, 'localconfig.vdf'), 'utf8').catch(() => ''),
      );
      const apps =
        local.UserLocalConfigStore?.Software?.Valve?.Steam?.apps ||
        local.UserLocalConfigStore?.Software?.Valve?.Steam?.Apps ||
        {};
      const ids = Object.keys(apps).filter(
        (id) => /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) > 0,
      );
      const knownIds = new Set(ids);
      const played = (id) => {
        const milliseconds = Number(apps[String(id)]?.LastPlayed) * 1000;
        return milliseconds > 0 && milliseconds <= Date.now()
          ? new Date(milliseconds).toISOString()
          : null;
      };
      const games = this.games
        .filter((game) => knownIds.has(String(game.steamId)))
        .map((game) => ({ ...game, lastPlayed: played(game.steamId) }));
      if (cached) {
        this.games = games;
        return this.games;
      }
      const resolved = new Set(games.map((game) => game.steamId));
      const deadline = Date.now() + 8000;
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, ids.length) }, async () => {
          while (next < ids.length && Date.now() < deadline) {
            const id = Number(ids[next++]);
            if (resolved.has(id)) continue;
            const info = await this.identity.details(id).catch(() => null);
            if (!info || info.type !== 'game' || isNonGame(info)) continue;
            games.push({
              id: 'steam-library:' + id,
              name: info.name,
              steamId: id,
              verified: true,
              identity: info,
              cover: info.cover,
              steamLibrary: true,
              status: 'not-installed',
              folder: null,
              folderExists: false,
              executable: null,
              installations: [],
              dlcs: [],
              demos: [],
              lastPlayed: played(id),
            });
          }
        }),
      );
      this.games = games;
      this.state = {
        connected: true,
        accountName,
        count: games.length,
        message:
          'Connected to the local Steam account. Shows confirmed games known to this Steam client; unplayed or uncached purchases may be unavailable.',
      };
      await this.identity.save().catch(() => {});
    } catch {
      this.games = [];
      this.state = {
        connected: false,
        message: 'Sign into the Steam desktop app to connect your library.',
      };
    }
    return this.games;
  }
  merge(installed) {
    const ids = new Set(installed.map((game) => Number(game.steamId)).filter(Boolean));
    const steamGames = new Map(this.games.map((game) => [Number(game.steamId), game]));
    return [
      ...installed.map((game) =>
        steamGames.has(Number(game.steamId))
          ? {
              ...game,
              steamLibrary: true,
              lastPlayed:
                (Date.parse(game.lastPlayed || '') || 0) >
                (Date.parse(steamGames.get(Number(game.steamId)).lastPlayed || '') || 0)
                  ? game.lastPlayed
                  : steamGames.get(Number(game.steamId)).lastPlayed,
            }
          : game,
      ),
      ...this.games.filter((game) => !ids.has(game.steamId)),
    ];
  }
}
module.exports = { SteamLibrary, parseTextVdf };

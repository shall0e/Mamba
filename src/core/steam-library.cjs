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
  async read() {
    if (Date.now() - this.at < 5 * 60000) return this.games;
    this.at = Date.now();
    try {
      const shortcutFile = await this.profile();
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
      const ids = Object.keys(apps).filter((id) => /^\d+$/.test(id) && Number(id) > 0);
      const games = [];
      const deadline = Date.now() + 8000;
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, ids.length) }, async () => {
          while (next < ids.length && Date.now() < deadline) {
            const id = Number(ids[next++]);
            const info = await this.identity.details(id).catch(() => null);
            if (!info || info.type !== 'game' || isNonGame(info)) continue;
            const timestamp = Number(apps[String(id)]?.LastPlayed);
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
              lastPlayed: timestamp > 0 ? new Date(timestamp * 1000).toISOString() : null,
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
    return [
      ...installed.map((game) =>
        this.games.some((item) => item.steamId === game.steamId)
          ? { ...game, steamLibrary: true }
          : game,
      ),
      ...this.games.filter((game) => !ids.has(game.steamId)),
    ];
  }
}
module.exports = { SteamLibrary, parseTextVdf };

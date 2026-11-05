(function (root) {
  const nameKey = (name) =>
    String(name || '')
      .replace(/[™®©]/g, '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  const steamId = (game) =>
    String(
      game.steamId ||
        game.identity?.steamId ||
        (/^steam:/.test(game.id || '') ? game.id.slice(6) : ''),
    );
  function installed(games, game) {
    const id = steamId(game);
    const name = nameKey(game.name);
    let firstMatch = null;
    for (const item of games) {
      if (['not-installed', 'drive-unavailable'].includes(item.status)) continue;
      const itemId = steamId(item);
      const matches = id && itemId ? id === itemId : name && nameKey(item.name) === name;
      if (!matches) continue;
      if (item.status === 'installed' && item.executable) return item;
      firstMatch ||= item;
    }
    return firstMatch;
  }
  function download(jobs, game) {
    const ids = new Set([game.id, ...(game.options || []).map((option) => option.gameId)]);
    const name = nameKey(game.name);
    return (
      jobs.find(
        (job) => job.status !== 'cancelled' && (ids.has(job.gameId) || nameKey(job.name) === name),
      ) || null
    );
  }
  function compareLibrary(a, b, sort = 'name') {
    const favorite = Number(!!b.favorite) - Number(!!a.favorite);
    const installedTime = (game) =>
      Math.max(
        0,
        ...[game, ...(game.installations || [])]
          .filter((item) => !['not-installed', 'drive-unavailable'].includes(item.status))
          .map((item) => Date.parse(item.installedAt || '') || 0),
      );
    const playedTime = (game) => Date.parse(game.lastPlayed || '') || 0;
    return (
      Number(b.status === 'installed') - Number(a.status === 'installed') ||
      (sort === 'installed' ? installedTime(b) - installedTime(a) : 0) ||
      (sort === 'recent' ? playedTime(b) - playedTime(a) : 0) ||
      favorite ||
      a.name.localeCompare(b.name)
    );
  }
  function confirmedGame(game) {
    return !!(game.verified && game.steamId);
  }
  const api = { confirmedGame, nameKey, installed, download, compareLibrary };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MambaPresence = api;
})(typeof window === 'undefined' ? globalThis : window);

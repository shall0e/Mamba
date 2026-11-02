(function (root) {
  function summary(jobs) {
    const downloading = jobs.filter((job) => job.status === 'downloading');
    const number = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0);
    return {
      count: downloading.length,
      speed: downloading.reduce((sum, job) => sum + number(job.speed), 0),
      remaining: downloading.reduce(
        (sum, job) => sum + Math.max(0, number(job.total) - number(job.received)),
        0,
      ),
      unknownSize: downloading.some((job) => !number(job.total)),
    };
  }
  function sample(history, jobs, now = Date.now()) {
    const next = history.filter((point) => point.at > now - 60000 && point.at <= now);
    const point = { at: now, speed: summary(jobs).speed };
    if (next.length && Math.floor(now / 1000) === Math.floor(next[next.length - 1].at / 1000))
      next[next.length - 1] = point;
    else next.push(point);
    return next.slice(-60);
  }
  function recent(games) {
    return games
      .filter(
        (game) =>
          game.status === 'installed' &&
          game.executable &&
          Number.isFinite(Date.parse(game.lastPlayed)),
      )
      .sort((a, b) => Date.parse(b.lastPlayed) - Date.parse(a.lastPlayed))
      .slice(0, 3);
  }
  function sidebarRecent(games) {
    const stamp = (value) => Date.parse(value) || 0;
    const played = games
      .filter((g) => stamp(g.lastPlayed) > 0)
      .sort((a, b) => stamp(b.lastPlayed) - stamp(a.lastPlayed));
    const newest = games
      .filter((g) => stamp(g.installedAt) > 0)
      .sort((a, b) => stamp(b.installedAt) - stamp(a.installedAt))[0];
    return newest && stamp(newest.lastPlayed) < stamp(newest.installedAt)
      ? [newest, ...played.filter((g) => g.id !== newest.id)]
      : played;
  }
  const api = { summary, sample, recent, sidebarRecent };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MambaActivity = api;
})(typeof window === 'undefined' ? globalThis : window);

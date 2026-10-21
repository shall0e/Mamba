function steamArtwork(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.endsWith('.steamstatic.com') ? url.href : null;
  } catch {
    return null;
  }
}
class SteamFeatured {
  constructor(identity, transport = fetch) {
    this.identity = identity;
    this.fetch = transport;
    this.items = [];
    this.updatedAt = 0;
    this.pending = null;
    this.ready = null;
  }
  async get() {
    if (!this.pending && (!this.items.length || Date.now() - this.updatedAt >= 30 * 60 * 1000)) {
      let release;
      this.ready = new Promise((resolve) => {
        release = resolve;
      });
      this.pending = this.refresh(release).finally(() => {
        release();
        this.pending = null;
      });

      this.pending.catch(() => {});
    }
    if (!this.items.length) await this.ready;
    return [...this.items];
  }
  async refresh(release = () => {}) {
    const read = async (url) => {
      try {
        const response = await this.fetch(url, { signal: AbortSignal.timeout(8000) });
        return response.ok ? await response.json() : {};
      } catch {
        return {};
      }
    };
    const [categories, featured, charts] = await Promise.all([
      read('https://store.steampowered.com/api/featuredcategories/?cc=CA&l=english'),
      read('https://store.steampowered.com/api/featured/?cc=CA&l=english'),
      read('https://api.steampowered.com/ISteamChartsService/GetMostPlayedGames/v1/'),
    ]);
    const rows = [
      ...['top_sellers', 'new_releases', 'specials', 'coming_soon'].map(
        (key) => categories[key]?.items || [],
      ),
      ...['featured_win', 'featured_mac', 'featured_linux', 'large_capsules'].map(
        (key) => featured[key] || [],
      ),
      (charts.response?.ranks || []).map((item) => ({ id: item.appid })),
    ];
    const seen = new Set(),
      candidates = [];
    for (let index = 0; index < Math.max(0, ...rows.map((row) => row.length)); index++)
      for (const row of rows) {
        const item = row[index],
          id = Number(item?.id);
        if (
          !Number.isSafeInteger(id) ||
          id <= 0 ||
          seen.has(id) ||
          (item.type !== undefined && item.type !== 0)
        )
          continue;
        seen.add(id);
        candidates.push(item);
      }
    let next = 0;
    const games = [];
    await Promise.all(
      Array.from({ length: Math.min(4, candidates.length) }, async () => {
        while (next < candidates.length) {
          const item = candidates[next++];
          const details = await this.identity.details(Number(item.id)).catch(() => null);

          if (details?.type !== 'game' || details.mature !== false) continue;
          const image =
            steamArtwork(item.large_capsule_image) ||
            steamArtwork(item.header_image) ||
            steamArtwork(details.steamArtwork);
          if (!image) continue;
          games.push({ id: Number(item.id), name: details.name, image });
          this.items = [...games];
          if (games.length >= 4) release();
        }
      }),
    );
    this.updatedAt = Date.now();
    return this.items;
  }
}
module.exports = { SteamFeatured };

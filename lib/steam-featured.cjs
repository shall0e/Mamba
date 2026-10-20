class SteamFeatured {
  constructor(identity, transport = fetch) { this.identity = identity; this.fetch = transport; this.items = []; this.updatedAt = 0; this.pending = null; }
  async get() {
    if (this.items.length && Date.now() - this.updatedAt < 30 * 60 * 1000) return this.items;
    if (this.pending) return this.pending;
    this.pending = this.refresh().finally(() => { this.pending = null; });
    return this.pending;
  }
  async refresh() {
    try {
      const response = await this.fetch('https://store.steampowered.com/api/featuredcategories/?cc=CA&l=english', { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('Steam featured games are unavailable.');
      const data = await response.json();
      const seen = new Set();
      const candidates = [];
      const categories = ['top_sellers', 'new_releases', 'specials', 'coming_soon'];
      const rows = categories.map(category => ({
        category,
        items: (data[category]?.items || []).filter(item => item?.type === 0)
      }));
      // Interleave the store's current charts so new releases and on-sale hits
      // appear throughout the wallpaper rotation beside top sellers.
      for (let index = 0; index < Math.max(...rows.map(row => row.items.length)); index++) for (const row of rows) {
        const item = row.items[index];
        if (!item) continue;
        const id = Number(item.id);
        if (item.type !== 0 || !Number.isSafeInteger(id) || id <= 0 || seen.has(id) || typeof item.name !== 'string') continue;
        const image = item.large_capsule_image || item.header_image;
        try {
          const url = new URL(image);
          if (url.protocol !== 'https:' || !url.hostname.endsWith('.steamstatic.com')) continue;
        } catch { continue; }
        seen.add(id);
        candidates.push({ id, name: item.name, image, category: row.category });
      }
      const verified = Array(candidates.length);
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(5, candidates.length) }, async () => {
        while (next < candidates.length) {
          const index = next++, item = candidates[index];
          const details = await this.identity.details(item.id).catch(() => null);
          if (details?.type === 'game' && !details.mature) verified[index] = { ...item, name: details.name };
        }
      }));
      const games = verified.filter(Boolean);
      for (let index = games.length - 1; index > 0; index--) {
        const swap = Math.floor(Math.random() * (index + 1));
        [games[index], games[swap]] = [games[swap], games[index]];
      }
      games.length = Math.min(games.length, 40);
      if (!games.length) throw new Error('Steam did not return any featured game art.');
      this.items = games; this.updatedAt = Date.now();
    } catch (error) {
      if (!this.items.length) throw error;
    }
    return this.items;
  }
}
module.exports = { SteamFeatured };

(() => {
  // One shared request per artwork id. Entries hold only the service result so a caller's
  // fallback image never leaks into the cache for other consumers of the same id.
  const cache = new Map();
  const LIMIT = 256;
  const MISSING_TTL = 60000;
  function request(id) {
    const key = String(id);
    const saved = cache.get(key);
    if (saved && saved.expires > Date.now()) {
      // Refresh recency so frequently shown artwork is not evicted first.
      cache.delete(key);
      cache.set(key, saved);
      return saved.promise;
    }
    const entry = { expires: Infinity };
    entry.promise = Promise.resolve(window.mamba.artwork(id))
      .then((image) => {
        if (!image) entry.expires = Date.now() + MISSING_TTL;
        return image || null;
      })
      .catch((error) => {
        if (cache.get(key) === entry) cache.delete(key);
        throw error;
      });
    cache.set(key, entry);
    while (cache.size > LIMIT) cache.delete(cache.keys().next().value);
    return entry.promise;
  }
  window.MambaArtwork = {
    get(id, fallback) {
      const shared = request(id);
      if (!fallback) return shared;
      return shared.then(
        (image) => image || fallback,
        () => fallback,
      );
    },
  };
})();

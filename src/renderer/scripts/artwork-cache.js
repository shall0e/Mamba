(() => {
  const cache = new Map();
  window.MambaArtwork = {
    get(id) {
      const key = String(id);
      const saved = cache.get(key);
      if (saved && saved.expires > Date.now()) return saved.promise;
      const entry = { expires: Infinity };
      entry.promise = window.mamba
        .artwork(id)
        .then((image) => {
          if (!image) entry.expires = Date.now() + 60000;
          return image;
        })
        .catch((error) => {
          cache.delete(key);
          throw error;
        });
      cache.set(key, entry);
      if (cache.size > 256) cache.delete(cache.keys().next().value);
      return entry.promise;
    },
  };
})();

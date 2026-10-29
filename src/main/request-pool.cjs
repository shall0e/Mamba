function requestPool(run, limit = 4) {
  const pending = new Map();
  const waiting = [];
  let active = 0;
  function drain() {
    while (active < limit && waiting.length) {
      const { key, resolve, reject } = waiting.shift();
      active++;
      Promise.resolve()
        .then(() => run(key))
        .then(resolve, reject)
        .finally(() => {
          pending.delete(key);
          active--;
          drain();
        });
    }
  }
  return (key) => {
    if (pending.has(key)) return pending.get(key);
    const result = new Promise((resolve, reject) => waiting.push({ key, resolve, reject }));
    pending.set(key, result);
    drain();
    return result;
  };
}
module.exports = { requestPool };

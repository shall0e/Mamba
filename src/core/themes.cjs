const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { atomicJson } = require('./library.cjs');
const { parse } = require('../shared/theme-model.js');
class Themes {
  constructor(directory) {
    this.file = path.join(directory, 'themes.json');
    this.queue = Promise.resolve();
  }
  async list() {
    try {
      const rows = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (!Array.isArray(rows)) throw Error('Saved themes must be a list.');
      return rows.flatMap((row) => {
        try {
          return [{ id: String(row.id), theme: parse(row.theme) }];
        } catch {
          return [];
        }
      });
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }
  remove(id) {
    if (typeof id !== 'string' || !id) throw Error('Select a saved theme to delete.');
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        const rows = await this.list();
        if (!rows.some((row) => row.id === id)) return false;
        await atomicJson(
          this.file,
          rows.filter((row) => row.id !== id),
        );
        return true;
      });
    this.queue = task;
    return task;
  }
  save(value) {
    const theme = parse(value);
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        const rows = await this.list();
        const existing = rows.find(
          (row) => row.theme.name.toLowerCase() === theme.name.toLowerCase(),
        );
        const entry = { id: existing?.id || randomUUID(), theme };
        await atomicJson(this.file, [...rows.filter((row) => row.id !== entry.id), entry]);
        return entry;
      });
    this.queue = task;
    return task;
  }
}
module.exports = { Themes };

const { EventEmitter } = require('node:events');

// Keep large catalogs and file operations out of Electron's window process.
class BackgroundClient extends EventEmitter {
  constructor(launch, options = {}) {
    super(); this.launch = launch; this.options = options;
    this.pending = new Map(); this.sequence = 0; this.restarts = [];
    this.closed = false; this.ready = null; this.child = null;
  }
  start() {
    if (this.closed) return Promise.reject(new Error('Mamba is closing.'));
    if (this.ready) return this.ready;
    this.ready = this.boot();
    // Automatic restarts must never create unhandled rejections.
    this.ready.catch(() => {});
    return this.ready;
  }
  async boot() {
    let child;
    try { child = this.launch(); }
    catch { this.emit('unavailable'); throw new Error('Could not start the background service. Restart Mamba.'); }
    this.child = child; this.lastHeartbeat = Date.now();
    child.on('message', message => {
      if (this.child !== child) return;
      if (message.type === 'heartbeat') { this.lastHeartbeat = Date.now(); return; }
      if (message.type === 'event') { this.emit(message.channel, message.data); return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.result);
    });
    child.once('exit', code => this.failed(child, code));
    child.once('error', () => this.failed(child, 'launch'));
    this.monitor = setInterval(() => {
      if (Date.now() - this.lastHeartbeat > (this.options.heartbeatTimeout || 90000)) {
        // Let exit drive recovery, so only one worker can own the files.
        child.kill();
      }
    }, this.options.monitorInterval || 10000);
    this.monitor.unref?.();
    try {
      await this.send('initialize', this.options.initialize, child);
      this.emit('ready');
    } catch (error) { child.kill(); throw error; }
  }
  send(method, args, child = this.child) {
    if (!child || this.closed && method !== 'shutdown') return Promise.reject(new Error('Background service is unavailable.'));
    if (this.pending.size >= 128) return Promise.reject(new Error('Mamba is busy. Try again shortly.'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('The background task is taking too long. Try again shortly.'));
      }, this.options.requestTimeout || 600000);
      this.pending.set(id, { resolve, reject, timer });
      try { child.postMessage({ id, method, args }); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new Error('Background service is unavailable.')); }
    });
  }
  async request(method, ...args) { await this.start(); return this.send(method, args); }
  failed(child, code) {
    if (this.child !== child) return;
    clearInterval(this.monitor); this.child = null; this.ready = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer); pending.reject(new Error('The background service stopped. Unfinished tasks are paused; retry after it reconnects.'));
    }
    this.pending.clear();
    if (this.closed) return;
    this.emit('interrupted', { code });
    const now = Date.now(); this.restarts = this.restarts.filter(at => now - at < 60000);
    if (this.restarts.length >= 3) {
      this.ready = Promise.reject(new Error('Background service could not recover. Restart Mamba.'));
      this.ready.catch(() => {}); this.emit('unavailable'); return;
    }
    this.restarts.push(now);
    this.restartTimer = setTimeout(() => this.start().catch(() => {}), this.options.restartDelay || 1500);
  }
  async close() {
    this.closed = true; clearTimeout(this.restartTimer); clearInterval(this.monitor);
    const child = this.child;
    if (!child) return;
    // Stop transfers and flush their queue before terminating the worker.
    let deadline;
    await Promise.race([this.send('shutdown', [], child).catch(() => {}), new Promise(resolve => { deadline = setTimeout(resolve, 4000); })]);
    clearTimeout(deadline);
    child.kill();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Mamba is closing.')); }
    this.pending.clear();
  }
}
module.exports = { BackgroundClient };

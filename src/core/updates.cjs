const { EventEmitter } = require('node:events');
class Updates extends EventEmitter {
  constructor(updater, { version, packaged, getConfig, canInstall = () => true }) {
    super();
    this.updater = updater;
    this.packaged = packaged;
    this.getConfig = getConfig;
    this.canInstall = canInstall;
    this.state = {
      version,
      status: packaged ? 'idle' : 'development',
      message: packaged
        ? 'Ready to check GitHub Releases.'
        : 'Updates are available in the installed Windows app.',
    };
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.allowPrerelease = false;
    updater.on('checking-for-update', () =>
      this.set({ status: 'checking', message: 'Checking GitHub Releases…' }),
    );
    updater.on('update-available', (info) =>
      this.set({
        status: 'downloading',
        latestVersion: info.version,
        message: 'Downloading version ' + info.version + '…',
      }),
    );
    updater.on('download-progress', (progress) =>
      this.set({
        status: 'downloading',
        percent: Math.round(progress.percent),
        message: 'Downloading update · ' + Math.round(progress.percent) + '%',
      }),
    );
    updater.on('update-not-available', () =>
      this.set({ status: 'current', message: 'You have the latest version.' }),
    );
    updater.on('update-downloaded', (info) =>
      this.set({
        status: 'ready',
        latestVersion: info.version,
        message:
          'Version ' +
          info.version +
          ' is ready. Restart to install, or it will install when you quit.',
      }),
    );
    updater.on('error', (error) =>
      this.set({
        status: 'error',
        message: /404|latest.yml|release/i.test(error.message)
          ? 'No update release is available yet. Try again later.'
          : 'Could not check or download the update. Check your connection and try again.',
      }),
    );
  }
  set(patch) {
    Object.assign(this.state, patch);
    this.emit('change', { ...this.state });
  }
  async check(manual = false) {
    if (!this.packaged) return { ...this.state };
    if (['checking', 'downloading', 'ready'].includes(this.state.status)) return { ...this.state };
    const config = await this.getConfig();
    if (!manual && config.automaticUpdates === false) return { ...this.state };
    try {
      await this.updater.checkForUpdates();
    } catch (error) {
      this.updater.emit('error', error);
    }
    return { ...this.state };
  }
  install() {
    if (this.state.status !== 'ready') throw Error('No downloaded update is ready.');
    if (!this.canInstall())
      throw Error('Finish or cancel active downloads and installation before restarting.');
    this.updater.quitAndInstall(false, true);
  }
  start() {
    this.initial = setTimeout(() => this.check().catch(() => {}), 10000);
    this.interval = setInterval(() => this.check().catch(() => {}), 6 * 60 * 60 * 1000);
  }
  stop() {
    clearTimeout(this.initial);
    clearInterval(this.interval);
  }
}
module.exports = { Updates };

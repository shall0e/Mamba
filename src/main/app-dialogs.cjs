const { randomUUID } = require('node:crypto');
function createAppDialogs(ipcMain) {
  const pending = new Map();
  ipcMain.handle('app:dialog-response', (event, id, response) => {
    const entry = pending.get(id);
    if (
      !entry ||
      entry.sender !== event.sender ||
      !Number.isInteger(response) ||
      response < 0 ||
      response >= entry.count
    )
      return false;
    entry.finish(response);
    return true;
  });
  return function showAppDialog(window, options) {
    const sender = window?.webContents;
    if (!sender || sender.isDestroyed())
      return Promise.resolve({ response: options.cancelId ?? 0 });
    return new Promise((resolve) => {
      const id = randomUUID();
      const buttons = options.buttons?.length ? options.buttons : ['OK'];
      const cancel = () => finish(options.cancelId ?? 0);
      const finish = (response) => {
        pending.delete(id);
        sender.removeListener('destroyed', cancel);
        sender.removeListener('did-start-navigation', cancel);
        resolve({ response });
      };
      pending.set(id, { sender, count: buttons.length, finish });
      sender.once('destroyed', cancel);
      sender.once('did-start-navigation', cancel);
      sender.send('app:dialog', {
        id,
        title: options.title || 'Mamba',
        message: options.message || '',
        detail: options.detail || '',
        type: options.type || 'info',
        buttons,
        defaultId: options.defaultId ?? 0,
        cancelId: options.cancelId ?? 0,
      });
    });
  };
}
module.exports = { createAppDialogs };

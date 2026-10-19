// Electron utility process: no windows or renderer access.
const { BackgroundService } = require('./lib/background-service.cjs');
const port = process.parentPort;
const send = message => port.postMessage(message);
const service = new BackgroundService((channel, data) => send({type:'event', channel, data}));
setInterval(() => send({type:'heartbeat'}), 5000).unref();
port.on('message', ({data}) => {
  if (!data || typeof data.method !== 'string') return;
  Promise.resolve().then(() => service.call(data.method, data.args)).then(
    result => send({id:data.id, result}),
    error => send({id:data.id, error:String(error.message || 'Background task failed.').slice(0, 500)})
  ).catch(() => {});
});

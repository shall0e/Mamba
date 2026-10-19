const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter, once } = require('node:events');
const { BackgroundClient } = require('../lib/background-client.cjs');

class Child extends EventEmitter {
  postMessage(message) {
    if (message.method === 'hold') return;
    setImmediate(() => this.emit('message', {id:message.id,result:message.method === 'initialize' ? true : message.args}));
  }
  kill() { this.emit('exit', 1); }
}
test('worker failures reject pending requests and recover in a different process', async () => {
  const children = [];
  const client = new BackgroundClient(() => { const child = new Child(); children.push(child); return child; }, {restartDelay:5});
  await client.start();
  const pending = client.request('hold');
  const rejected = assert.rejects(pending, /background service stopped/i);
  await new Promise(resolve => setImmediate(resolve));
  const recovered = once(client, 'ready'); children[0].kill();
  await rejected; await recovered;
  assert.equal(children.length, 2); assert.deepEqual(await client.request('echo', 123), [123]);
  await client.close();
});
test('request deadlines release pending entries without replaying the operation', async () => {
  const client = new BackgroundClient(() => new Child(), {requestTimeout:20});
  await client.start(); await assert.rejects(client.request('hold'), /taking too long/);
  assert.equal(client.pending.size, 0); await client.close();
});
test('repeated crashes stop automatic restarts', async () => {
  const client = new BackgroundClient(() => new Child(), {restartDelay:5});
  await client.start();
  for (let i = 0; i < 3; i++) { const recovered = once(client,'ready'); client.child.kill(); await recovered; }
  const unavailable = once(client,'unavailable'); client.child.kill(); await unavailable;
  await assert.rejects(client.request('echo'), /could not recover/);
  assert.equal(client.child, null); await client.close();
});

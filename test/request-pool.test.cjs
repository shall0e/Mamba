const test = require('node:test');
const assert = require('node:assert/strict');
const { requestPool } = require('../src/main/request-pool.cjs');
test('large libraries cannot flood background IPC with artwork requests', async () => {
  let active = 0,
    peak = 0,
    calls = 0;
  const release = [];
  const request = requestPool(async (id) => {
    calls++;
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => release.push(resolve));
    active--;
    return id;
  });
  const jobs = Array.from({ length: 200 }, (_, id) => request(id));
  assert.equal(request(0), jobs[0]);
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    release.splice(0).forEach((resolve) => resolve());
  }
  assert.equal((await Promise.all(jobs)).length, 200);
  assert.equal(peak, 4);
  assert.equal(calls, 200);
});
test('failed requests release their slots and allow queued requests to continue', async () => {
  const request = requestPool(async (id) => {
    if (id === 0) throw Error('offline');
    return id;
  }, 1);
  await Promise.all([
    assert.rejects(request(0), /offline/),
    request(1).then((value) => assert.equal(value, 1)),
  ]);
});

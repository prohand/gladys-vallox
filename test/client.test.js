import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { ValloxClient, ValloxError, webSocketRequest } from '../src/vallox/client.js';
import { BUILT_IN_ADDRESSES } from '../src/vallox/model.js';
import { toKelvin } from '../src/vallox/protocol.js';
import { FAKE_UUID, createFakeUnit } from './helpers/fakeVallox.js';
import { bundle } from './helpers/bundle.js';

const noModel = async () => {
  throw new Error('HTTP 404');
};

function clientFor(unit, options = {}) {
  return new ValloxClient('192.168.1.50', {
    request: unit.request,
    getText: noModel,
    retryDelays: [],
    ...options,
  });
}

test('a snapshot is read with one READ_TABLES frame', async () => {
  const unit = createFakeUnit();
  const client = clientFor(unit);
  const snapshot = await client.readSnapshot();
  assert.equal(snapshot.info.uuid, FAKE_UUID);
  assert.equal(snapshot.temperatures.extract, 21.7);
  assert.equal(unit.frames[0].toString('hex'), '0300f6000000f900');
  assert.equal(client.model.source, 'built-in');
});

test("the unit's own data model is used when it serves one", async () => {
  const unit = createFakeUnit();
  const client = clientFor(unit, { getText: async () => bundle() });
  assert.equal((await client.readSnapshot()).info.uuid, FAKE_UUID);
  assert.equal(client.model.source, 'unit');
});

test('the built-in model serves while the unit has none to give', async () => {
  const unit = createFakeUnit();
  const paths = [];
  const client = clientFor(unit, {
    getText: async (url) => {
      paths.push(url);
      if (url.endsWith('/js/bundle.js')) throw new Error('HTTP 404');
      return 'not a model';
    },
  });
  await client.readSnapshot();
  assert.deepEqual(paths, ['http://192.168.1.50/js/bundle.js', 'http://192.168.1.50/js/vallox.js']);
  assert.equal(client.model.source, 'built-in');
  // A failed read is tried again next time.
  await client.readSnapshot();
  assert.equal(paths.length, 4);
});

test('writes go by register name, temperatures in °C', async () => {
  const unit = createFakeUnit();
  const client = clientFor(unit);
  await client.write({ A_CYC_HOME_AIR_TEMP_TARGET: 19, A_CYC_HOME_SPEED_SETTING: 55 });
  assert.deepEqual(unit.writes, [
    { A_CYC_HOME_SPEED_SETTING: 55, A_CYC_HOME_AIR_TEMP_TARGET: toKelvin(19) },
  ]);
  assert.equal((await client.readSnapshot()).targets.home, 19);
});

test('a register outside the allowed list is never written', async () => {
  const unit = createFakeUnit();
  const client = clientFor(unit);
  await assert.rejects(client.write({ A_CYC_MACHINE_MODEL: 1 }), ValloxError);
  assert.equal(unit.writes.length, 0);
});

test('a network failure is retried, then reported', async () => {
  const unit = createFakeUnit();
  unit.online = false;
  const client = clientFor(unit, { retryDelays: [1, 1] });
  await assert.rejects(client.readSnapshot(), (error) => {
    assert.ok(error instanceof ValloxError);
    assert.match(error.message, /Cannot reach 192\.168\.1\.50/);
    return true;
  });
  assert.equal(unit.frames.length, 3);

  // Back online between two attempts: the request succeeds.
  let calls = 0;
  const flaky = clientFor(unit, {
    retryDelays: [1],
    request: async (host, frame) => {
      calls += 1;
      if (calls === 1) throw new Error('ECONNRESET');
      unit.online = true;
      return unit.request(host, frame);
    },
  });
  assert.equal((await flaky.readSnapshot()).info.uuid, FAKE_UUID);
});

test('a truncated answer is refused', async () => {
  const client = clientFor(createFakeUnit(), { request: async () => Buffer.alloc(20) });
  await assert.rejects(client.readSnapshot(), /truncated/);
});

test('requests to one unit never overlap', async () => {
  const unit = createFakeUnit();
  let inFlight = 0;
  let maxInFlight = 0;
  const client = clientFor(unit, {
    request: async (host, frame) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return unit.request(host, frame);
    },
  });
  await Promise.all([client.readSnapshot(), client.write({ A_CYC_STATE: 1 }), client.readRaw()]);
  assert.equal(maxInFlight, 1);
});

test('the WebSocket transport sends one frame and resolves the binary answer', async (t) => {
  const unit = createFakeUnit();
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  t.after(() => server.close());
  await new Promise((resolve) => server.on('listening', resolve));
  server.on('connection', (socket) => {
    socket.on('message', async (data) => socket.send(await unit.request('', Buffer.from(data))));
  });
  const host = `127.0.0.1:${server.address().port}`;
  const client = new ValloxClient(host, { getText: noModel });
  const snapshot = await client.readSnapshot();
  assert.equal(snapshot.info.uuid, FAKE_UUID);
  await client.write({ A_CYC_STATE: 1 });
  assert.equal(unit.registers.A_CYC_STATE, 1);
  assert.equal(BUILT_IN_ADDRESSES.A_CYC_STATE, 4609);
});

test('the WebSocket transport gives up on a silent unit and on a refused connection', async (t) => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  t.after(() => server.close());
  await new Promise((resolve) => server.on('listening', resolve));
  const host = `127.0.0.1:${server.address().port}`;
  await assert.rejects(webSocketRequest(host, Buffer.from([1, 2]), { timeout: 100 }), /No answer/);

  server.on('connection', (socket) => socket.close());
  await assert.rejects(
    webSocketRequest(host, Buffer.from([1, 2]), { timeout: 2000 }),
    /closed the connection|Cannot reach/,
  );
  await assert.rejects(webSocketRequest('127.0.0.1:1', Buffer.from([1, 2]), { timeout: 2000 }), {
    name: 'Error',
  });
});

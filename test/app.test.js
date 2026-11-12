// -----------------------------------------------------------------------------
// The whole integration, end to end: the real handlers (src/app.js) against
// the SDK's fake Gladys and in-memory Vallox units. No network.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { registerHandlers } from '../src/app.js';
import { ValloxClient } from '../src/vallox/client.js';
import { UnitStore } from '../src/vallox/store.js';
import { TRIGGERS } from '../src/units.js';
import { unitIds } from '../src/devices/ventilation.js';
import { toKelvin } from '../src/vallox/protocol.js';
import { FAKE_UUID, createFakeUnit } from './helpers/fakeVallox.js';

const HOST = '192.168.1.50';

async function setup(t, { config = { hosts: HOST }, units: fakeUnits, dataDir } = {}) {
  const dir = dataDir ?? (await mkdtemp(join(tmpdir(), 'vallox-')));
  if (!dataDir) t.after(() => rm(dir, { recursive: true, force: true }));
  const fakes = fakeUnits ?? { [HOST]: createFakeUnit() };
  const gladys = createFakeGladys({ config });
  const { units } = registerHandlers(gladys, {
    store: new UnitStore(dir),
    createClient: (host) =>
      new ValloxClient(host, {
        request: (h, frame) => {
          if (!fakes[h]) throw new Error('EHOSTUNREACH');
          return fakes[h].request(h, frame);
        },
        getText: async () => {
          throw new Error('HTTP 404');
        },
        retryDelays: [],
      }),
  });
  t.after(() => units.stop());
  await gladys.connect();
  const ids = unitIds(gladys, FAKE_UUID);
  const device = gladys.fake.discoveredDevices[0];
  const feature = (key) => device.features.find((f) => f.external_id === ids.feature(key));
  return { gladys, units, fake: fakes[HOST], fakes, ids, device, feature, dir };
}

test('on connection, the unit is read and published with its states', async (t) => {
  const { gladys, ids, device } = await setup(t);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  assert.equal(device.external_id, ids.device);
  assert.equal(gladys.fake.lastState(ids.feature('extract-temperature')), 21.7);
  assert.equal(gladys.fake.lastState(ids.feature('co2')), 640);
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: ids.device,
    transport: 'local',
  });
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
  assert.ok(gladys.fake.widgetRefreshes.includes('ventilation'));
});

test('the identity of a unit met once is remembered in /data', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'vallox-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const first = await setup(t, { dataDir: dir });
  const saved = JSON.parse(await readFile(join(dir, 'units.json'), 'utf8'));
  assert.equal(saved.units[HOST].uuid, FAKE_UUID);
  await first.gladys.disconnect();

  // Next start, the unit is off: its device is still published, unreachable.
  const offline = createFakeUnit();
  offline.online = false;
  const { gladys, ids } = await setup(t, { dataDir: dir, units: { [HOST]: offline } });
  assert.equal(gladys.fake.discoveredDevices[0].external_id, ids.device);
  assert.equal(gladys.fake.transports.at(-1).transport, 'unreachable');
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /Pas de réponse de 192\.168\.1\.50/);
});

test('a unit offline at startup is published as soon as it answers', async (t) => {
  const unit = createFakeUnit();
  unit.online = false;
  const { gladys, units, ids } = await setup(t, { units: { [HOST]: unit } });
  assert.deepEqual(gladys.fake.discoveredDevices, []);
  unit.online = true;
  await units.refreshAll();
  assert.equal(gladys.fake.discoveredDevices[0].external_id, ids.device);
  assert.equal(gladys.fake.lastState(ids.feature('fan-speed')), 40);
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
});

test('a switch command writes the unit and publishes the result', async (t) => {
  const { gladys, fake, device, feature, ids } = await setup(t);
  assert.deepEqual(await gladys.fake.setValue(device, feature('boost'), 1), { success: true });
  assert.equal(fake.registers.A_CYC_BOOST_TIMER, 30);
  assert.equal(gladys.fake.lastState(ids.feature('boost')), 1);
  assert.equal(gladys.fake.lastState(ids.feature('profile-time-left')), 30);

  await gladys.fake.setValue(device, feature('home-target-temperature'), 18.5);
  assert.equal(fake.registers.A_CYC_HOME_AIR_TEMP_TARGET, toKelvin(18.5));
  assert.equal(gladys.fake.lastState(ids.feature('home-target-temperature')), 18.5);

  await gladys.fake.setValue(device, feature('power'), 0);
  assert.equal(fake.registers.A_CYC_MODE, 5);

  // Gladys' own orders never fire profile_changed.
  assert.deepEqual(gladys.fake.sceneEvents, []);

  const refused = await gladys.fake.setValue(device, feature('co2'), 1);
  assert.equal(refused.success, false);
  const unknown = await gladys.fake.setValue({ external_id: 'ext:test-integration:x' }, {}, 1);
  assert.equal(unknown.success, false);
});

test('a profile changed on the unit itself fires profile_changed', async (t) => {
  const { gladys, units, fake, ids } = await setup(t);
  fake.set({ A_CYC_FIREPLACE_TIMER: 15 });
  await units.refreshAll();
  assert.deepEqual(gladys.fake.sceneEvents, [
    {
      key: TRIGGERS.PROFILE_CHANGED,
      data: {
        device: ids.device,
        device_name: 'ValloPlus 350 MV',
        profile: 'fireplace',
        previous_profile: 'home',
      },
    },
  ]);
  // No change, no event.
  await units.refreshAll();
  assert.equal(gladys.fake.sceneEvents.length, 1);
});

test('the device name is the one the user gave in Gladys', async (t) => {
  const { gladys, units, fake, device } = await setup(t);
  await gladys.fake.deviceCreated({ ...device, name: 'VMC grenier' });
  fake.set({ A_CYC_STATE: 1 });
  await units.refreshAll();
  assert.equal(gladys.fake.sceneEvents[0].data.device_name, 'VMC grenier');
});

test('a new active alarm fires alarm_raised once', async (t) => {
  const { gladys, units, fake } = await setup(t);
  fake.set({
    A_CYC_TOTAL_FAULT_COUNT: 1,
    A_CYC_FAULT_CODE: 9,
    A_CYC_FAULT_SEVERITY: 0,
    A_CYC_FAULT_ACTIVITY: 1,
  });
  await units.refreshAll();
  await units.refreshAll();
  const events = gladys.fake.sceneEvents.filter((e) => e.key === TRIGGERS.ALARM_RAISED);
  assert.equal(events.length, 1);
  assert.equal(events[0].data.alarm, 'filters_dirty');
  assert.equal(events[0].data.severity, 'mild');
  assert.equal(events[0].data.code, 9);
  assert.equal(events[0].data.message, 'Filters dirty');
});

test('the filter trigger fires when the days left cross the threshold', async (t) => {
  const { gladys, units, fake } = await setup(t, {
    config: { hosts: HOST, filter_warning_days: 14 },
  });
  fake.set({ A_CYC_REMAINING_TIME_FOR_FILTER: 15 });
  await units.refreshAll();
  fake.set({ A_CYC_REMAINING_TIME_FOR_FILTER: 14 });
  await units.refreshAll();
  fake.set({ A_CYC_REMAINING_TIME_FOR_FILTER: 13 });
  await units.refreshAll();
  const events = gladys.fake.sceneEvents.filter((e) => e.key === TRIGGERS.FILTER_CHANGE_DUE);
  assert.equal(events.length, 1);
  assert.equal(events[0].data.days_left, 14);
  assert.equal(events[0].data.next_change, '2026-07-07');
});

test('a unit that stops answering fires unit_unreachable after two failed reads', async (t) => {
  const { gladys, units, fake, ids } = await setup(t);
  fake.online = false;
  await units.refreshAll();
  assert.equal(gladys.fake.sceneEvents.length, 0, 'one lost answer is not worth a scene');
  assert.equal(gladys.fake.transports.at(-1).transport, 'local');
  await units.refreshAll();
  assert.deepEqual(gladys.fake.sceneEvents.at(-1), {
    key: TRIGGERS.UNIT_UNREACHABLE,
    data: { device: ids.device, device_name: 'ValloPlus 350 MV', host: HOST },
  });
  assert.equal(gladys.fake.transports.at(-1).transport, 'unreachable');
  assert.equal(gladys.fake.connectionStatus.connected, false);
  await units.refreshAll();
  assert.equal(gladys.fake.sceneEvents.length, 1);

  fake.online = true;
  await units.refreshAll();
  assert.equal(gladys.fake.transports.at(-1).transport, 'local');
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
});

test('scene action set_profile switches the profile without firing the trigger', async (t) => {
  const { gladys, units, fake, ids } = await setup(t);
  const ack = await gladys.fake.sceneAction('set_profile', {
    device: ids.device,
    profile: 'boost',
    duration: 45,
  });
  assert.deepEqual(ack, { success: true, data: { outputs: { profile: 'boost' } } });
  assert.equal(fake.registers.A_CYC_BOOST_TIMER, 45);
  await units.refreshAll();
  assert.deepEqual(gladys.fake.sceneEvents, []);

  const away = await gladys.fake.sceneAction('set_profile', {
    device: ids.device,
    profile: 'away',
  });
  assert.deepEqual(away.data.outputs, { profile: 'away' });
  assert.equal(fake.registers.A_CYC_BOOST_TIMER, 0);
  assert.equal(fake.registers.A_CYC_STATE, 1);

  const wrong = await gladys.fake.sceneAction('set_profile', { device: ids.device, profile: 'x' });
  assert.equal(wrong.success, false);
});

test('scene action set_fan_speed writes the speed of a profile', async (t) => {
  const { gladys, fake, ids } = await setup(t);
  const ack = await gladys.fake.sceneAction('set_fan_speed', {
    device: ids.device,
    profile: 'away',
    speed: 25,
  });
  assert.deepEqual(ack, { success: true, data: { outputs: { speed: 25 } } });
  assert.equal(fake.registers.A_CYC_AWAY_SPEED_SETTING, 25);
  assert.equal(gladys.fake.lastState(ids.feature('away-fan-speed')), 25);
  const bad = await gladys.fake.sceneAction('set_fan_speed', {
    device: ids.device,
    profile: 'away',
    speed: 150,
  });
  assert.equal(bad.success, false);
});

test('scene action read_values returns the current values', async (t) => {
  const { gladys, fake, ids } = await setup(t);
  fake.set({ A_CYC_CO2_VALUE: 0 });
  const ack = await gladys.fake.sceneAction('read_values', { device: ids.device });
  assert.deepEqual(ack.data.outputs, {
    profile: 'home',
    indoor_temperature: 21.7,
    outdoor_temperature: -2.7,
    supply_temperature: 19.5,
    humidity: 45,
    fan_speed: 40,
    filter_days_left: 120,
  });
  fake.online = false;
  const failed = await gladys.fake.sceneAction('read_values', { device: ids.device });
  assert.equal(failed.success, false);
});

test('recording a filter change writes today, from a scene or the configuration', async (t) => {
  const { gladys, fake, ids } = await setup(t);
  const ack = await gladys.fake.sceneAction('reset_filter_reminder', { device: ids.device });
  const today = new Date();
  assert.equal(fake.registers.A_CYC_FILTER_CHANGED_DAY, today.getDate());
  assert.equal(fake.registers.A_CYC_FILTER_CHANGED_YEAR, today.getFullYear() - 2000);
  assert.match(ack.data.outputs.next_change, /^\d{4}-\d{2}-\d{2}$/);

  const action = await gladys.fake.action('reset_filter_reminder', { device: ids.device });
  assert.equal(action.success, true);
  assert.match(action.data.message.fr, /Changement de filtre enregistré/);
  assert.match(action.data.message.de, /Filterwechsel heute erfasst/);
});

test('test_connection reports every unit, answering or not', async (t) => {
  const { gladys } = await setup(t, {
    config: { hosts: `${HOST}, 192.168.1.99` },
  });
  const ack = await gladys.fake.action('test_connection');
  assert.equal(ack.success, true);
  const [first, second] = ack.data.message.en.split('\n');
  assert.match(first, /192\.168\.1\.50: ValloPlus 350 MV 2\.0\.16, profile Home, indoor 21\.7 °C/);
  assert.match(second, /192\.168\.1\.99: no answer/);
  assert.match(ack.data.message.es, /perfil En casa/);
});

test('without any address, the status asks for one', async (t) => {
  const { gladys } = await setup(t, { config: {} });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /Enter the IP address/);
  const ack = await gladys.fake.action('test_connection');
  assert.match(ack.data.message.fr, /Aucune adresse configurée/);
  const widget = await gladys.fake.widgetGet('ventilation');
  assert.deepEqual(validateWidgetContent(widget.data.content), []);
});

test('a configuration update re-reads the units', async (t) => {
  const { gladys, units } = await setup(t, { config: {} });
  await gladys.fake.configUpdated({ hosts: HOST, poll_frequency: 30 });
  assert.equal(units.list().length, 1);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
});

test('the widget content fits the core vocabulary and budget', async (t) => {
  const { gladys, ids } = await setup(t);
  for (const language of ['en', 'fr', 'de', 'es']) {
    const ack = await gladys.fake.widgetGet('ventilation', { language });
    assert.equal(ack.success, true);
    assert.deepEqual(validateWidgetContent(ack.data.content), [], language);
  }
  const { content } = (await gladys.fake.widgetGet('ventilation')).data;
  assert.ok(content.components.length <= 8);
  const tiles = content.components.filter((c) => c.type === 'value');
  assert.deepEqual(
    tiles.map((tile) => tile.device_feature),
    [
      ids.feature('extract-temperature'),
      ids.feature('outdoor-temperature'),
      ids.feature('fan-speed'),
      ids.feature('co2'),
    ],
  );
  const buttons = content.components.filter((c) => c.type === 'button');
  assert.deepEqual(
    buttons.map((b) => b.action.key),
    ['set_home', 'set_away', 'set_boost'],
  );
});

test('the widget shows an alarm, a boost, and an unreachable unit', async (t) => {
  const { gladys, units, fake } = await setup(t);
  fake.set({
    A_CYC_BOOST_TIMER: 75,
    A_CYC_TOTAL_FAULT_COUNT: 1,
    A_CYC_FAULT_CODE: 2,
    A_CYC_FAULT_SEVERITY: 1,
    A_CYC_FAULT_ACTIVITY: 1,
  });
  await units.refreshAll();
  let content = (await gladys.fake.widgetGet('ventilation')).data.content;
  assert.deepEqual(validateWidgetContent(content), []);
  const items = content.components.find((c) => c.type === 'status').items;
  assert.deepEqual(items.find((i) => i.label.en === 'Time left').value, '1 h 15');
  assert.equal(items.find((i) => i.label.en === 'Alarms').color, 'danger');

  fake.online = false;
  await units.refreshAll();
  await units.refreshAll();
  content = (await gladys.fake.widgetGet('ventilation')).data.content;
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components.filter((c) => c.type === 'button').length, 0);
});

test('a widget button switches the profile and answers with a toast', async (t) => {
  const { gladys, fake, ids } = await setup(t);
  const ack = await gladys.fake.widgetAction('ventilation', 'set_away', { device: ids.device });
  assert.equal(ack.success, true);
  assert.equal(fake.registers.A_CYC_STATE, 1);
  assert.equal(ack.data.message.fr, 'Profil : Absence');
  assert.equal(ack.data.message.en, 'Profile: Away');
  const unknown = await gladys.fake.widgetAction('ventilation', 'explode', {});
  assert.equal(unknown.success, false);
});

test('two units: the widget picks the chosen one and titles it', async (t) => {
  const other = createFakeUnit({ A_CYC_UUID7: 0x0001, A_CYC_MACHINE_MODEL: 3 });
  const { gladys, units } = await setup(t, {
    config: { hosts: `${HOST}, 192.168.1.51` },
    units: { [HOST]: createFakeUnit(), '192.168.1.51': other },
  });
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.name),
    ['ValloPlus 350 MV (192.168.1.50)', 'Vallox 145 MV (192.168.1.51)'],
  );
  const second = units.list()[1];
  const device = unitIds(gladys, second.uuid).device;
  const { content } = (await gladys.fake.widgetGet('ventilation', { settings: { device } })).data;
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[0].text, 'Vallox 145 MV (192.168.1.51)');
  // Without a chosen device a scene action refuses to guess.
  const ack = await gladys.fake.sceneAction('read_values', {});
  assert.equal(ack.success, false);
});

test('the same unit typed twice is published once', async (t) => {
  const unit = createFakeUnit();
  const { gladys } = await setup(t, {
    config: { hosts: `${HOST}, vallox.lan` },
    units: { [HOST]: unit, 'vallox.lan': unit },
  });
  assert.equal(gladys.fake.discoveredDevices.length, 1);
});

test('a scan request re-reads and re-publishes the units', async (t) => {
  const { gladys, fake } = await setup(t);
  const reads = fake.reads;
  await gladys.fake.scanRequest();
  assert.equal(fake.reads, reads + 1);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
});

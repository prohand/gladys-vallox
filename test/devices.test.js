import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  FEATURES,
  buildDevice,
  buildStates,
  commandRegisters,
  featureKeyOf,
  profileRegisters,
  unitIds,
} from '../src/devices/ventilation.js';
import { toSnapshot } from '../src/vallox/metrics.js';
import { FAKE_UUID, defaultRegisters } from './helpers/fakeVallox.js';

const unit = {
  host: '192.168.1.50',
  uuid: FAKE_UUID,
  model: 'ValloPlus 350 MV',
  sw_version: '2.0.16',
};
const snapshot = (overrides = {}) => toSnapshot({ ...defaultRegisters(), ...overrides });

test('the device is accepted by Gladys as it is published', async () => {
  const gladys = createFakeGladys();
  await gladys.publishDiscoveredDevices([buildDevice(gladys, unit)]);
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.name, 'ValloPlus 350 MV');
  assert.equal(device.external_id, `ext:test-integration:vallox:${FAKE_UUID}`);
  assert.equal(device.should_poll, false);
  assert.deepEqual(device.params, [
    { name: 'host', value: '192.168.1.50' },
    { name: 'firmware', value: '2.0.16' },
  ]);
  assert.equal(device.features.length, FEATURES.length);
  for (const feature of device.features) {
    // min and max are NOT NULL in Gladys.
    assert.equal(typeof feature.min, 'number', feature.external_id);
    assert.equal(typeof feature.max, 'number', feature.external_id);
    assert.equal(feature.has_feedback, !feature.read_only);
  }
  assert.equal(new Set(device.features.map((f) => f.external_id)).size, FEATURES.length);
});

test('with several units, the address tells them apart', () => {
  const gladys = createFakeGladys();
  assert.equal(
    buildDevice(gladys, { ...unit, model: null }, { withHost: true }).name,
    'Vallox (192.168.1.50)',
  );
});

test('the states are accepted by Gladys, absent values left out', async () => {
  const gladys = createFakeGladys();
  const states = buildStates(gladys, FAKE_UUID, snapshot({ A_CYC_CO2_VALUE: 0 }));
  await gladys.publishStates(states);
  const ids = unitIds(gladys, FAKE_UUID);
  assert.equal(gladys.fake.lastState(ids.feature('extract-temperature')), 21.7);
  assert.equal(gladys.fake.lastState(ids.feature('power')), 1);
  assert.equal(gladys.fake.lastState(ids.feature('boost')), 0);
  assert.equal(gladys.fake.lastState(ids.feature('home-target-temperature')), 20);
  assert.equal(gladys.fake.lastState(ids.feature('filter-days-left')), 120);
  assert.equal(gladys.fake.lastState(ids.feature('co2')), undefined);
});

test('a feature external id gives back its key', () => {
  const gladys = createFakeGladys();
  const ids = unitIds(gladys, FAKE_UUID);
  assert.equal(featureKeyOf(gladys, FAKE_UUID, ids.feature('boost')), 'boost');
  assert.equal(featureKeyOf(gladys, FAKE_UUID, 'ext:test-integration:other:boost'), null);
});

test('commands map to the registers of the unit', () => {
  const s = snapshot();
  assert.deepEqual(commandRegisters('power', 0, s), { A_CYC_MODE: 5 });
  assert.deepEqual(commandRegisters('power', 1, s), { A_CYC_MODE: 0 });
  assert.deepEqual(commandRegisters('away', 1, s), { A_CYC_STATE: 1 });
  assert.deepEqual(commandRegisters('boost', 1, s), {
    A_CYC_BOOST_TIMER: 30,
    A_CYC_FIREPLACE_TIMER: 0,
    A_CYC_EXTRA_TIMER: 0,
  });
  assert.deepEqual(commandRegisters('boost', 0, s), { A_CYC_BOOST_TIMER: 0 });
  assert.deepEqual(commandRegisters('fireplace', 1, s).A_CYC_FIREPLACE_TIMER, 15);
  assert.deepEqual(commandRegisters('away-fan-speed', 150, s), { A_CYC_AWAY_SPEED_SETTING: 100 });
  assert.deepEqual(commandRegisters('boost-target-temperature', 2, s), {
    A_CYC_BOOST_AIR_TEMP_TARGET: 5,
  });
  assert.throws(() => commandRegisters('co2', 1, s), /cannot be controlled/);
  assert.throws(() => commandRegisters('unknown', 1, s), /cannot be controlled/);
  assert.throws(() => commandRegisters('home-fan-speed', 'abc', s), /Invalid value/);
});

test('a profile clears the other timers; a duration overrides the unit default', () => {
  const s = snapshot();
  assert.deepEqual(profileRegisters('home', s), {
    A_CYC_BOOST_TIMER: 0,
    A_CYC_FIREPLACE_TIMER: 0,
    A_CYC_EXTRA_TIMER: 0,
    A_CYC_STATE: 0,
  });
  assert.equal(profileRegisters('away', s).A_CYC_STATE, 1);
  assert.equal(profileRegisters('boost', s, 45).A_CYC_BOOST_TIMER, 45);
  assert.equal(profileRegisters('boost', s, 0).A_CYC_BOOST_TIMER, 30);
  assert.equal(profileRegisters('boost', null).A_CYC_BOOST_TIMER, 30);
  assert.equal(profileRegisters('extra', s).A_CYC_EXTRA_TIMER, 10);
  assert.throws(() => profileRegisters('party', s), /Unknown profile/);
});

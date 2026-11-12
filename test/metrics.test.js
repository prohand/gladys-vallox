import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROFILES, activeAlarms, toSnapshot } from '../src/vallox/metrics.js';
import { toKelvin } from '../src/vallox/protocol.js';
import { FAKE_UUID, defaultRegisters } from './helpers/fakeVallox.js';

const snapshot = (overrides = {}) => toSnapshot({ ...defaultRegisters(), ...overrides });

test('a unit at home reads as such, with its identity and values', () => {
  const s = snapshot();
  assert.deepEqual(s.info, { uuid: FAKE_UUID, model: 'ValloPlus 350 MV', sw_version: '2.0.16' });
  assert.equal(s.profile, PROFILES.HOME);
  assert.equal(s.on, true);
  assert.equal(s.away, false);
  assert.equal(s.boost, false);
  assert.equal(s.profile_time_left, 0);
  assert.deepEqual(s.temperatures, {
    extract: 21.7,
    exhaust: 5,
    outdoor: -2.7,
    supply: 19.5,
    supply_cell: 18.2,
  });
  assert.equal(s.humidity, 45);
  assert.equal(s.co2, 640);
  assert.equal(s.fan_speed, 40);
  assert.deepEqual(s.speeds, { home: 40, away: 20, boost: 90 });
  assert.deepEqual(s.targets, { home: 20, away: 18, boost: 17 });
  assert.equal(s.cell_state, 'heat_recovery');
  assert.equal(s.filter_days_left, 120);
  assert.equal(s.filter_changed, '2026-01-08');
  assert.equal(s.filter_next_change, '2026-07-07');
  assert.deepEqual(s.alarms, []);
});

test('a running timer wins over the base state', () => {
  assert.equal(snapshot({ A_CYC_STATE: 1 }).profile, PROFILES.AWAY);
  const boost = snapshot({ A_CYC_STATE: 1, A_CYC_BOOST_TIMER: 25 });
  assert.equal(boost.profile, PROFILES.BOOST);
  assert.equal(boost.boost, true);
  assert.equal(boost.away, true, 'away stays the base the unit goes back to');
  assert.equal(boost.profile_time_left, 25);
  assert.equal(snapshot({ A_CYC_FIREPLACE_TIMER: 10 }).profile, PROFILES.FIREPLACE);
  assert.equal(snapshot({ A_CYC_EXTRA_TIMER: 5 }).profile, PROFILES.EXTRA);
});

test('a timer of 0xFFFF is a profile without time limit', () => {
  const s = snapshot({ A_CYC_BOOST_TIMER: 0xffff });
  assert.equal(s.profile, PROFILES.BOOST);
  assert.equal(s.profile_time_left, null);
});

test('missing sensors read as null, not as zero', () => {
  const s = snapshot({
    A_CYC_CO2_VALUE: 0,
    A_CYC_RH_VALUE: 0xffff,
    A_CYC_TEMP_OUTDOOR_AIR: 0,
    A_CYC_FAN_SPEED: 0xffff,
  });
  assert.equal(s.co2, null);
  assert.equal(s.humidity, null);
  assert.equal(s.temperatures.outdoor, null);
  assert.equal(s.fan_speed, null);
});

test('mode 5 is a stopped unit', () => {
  assert.equal(snapshot({ A_CYC_MODE: 5 }).on, false);
});

test('an unknown model or an empty UUID is not invented', () => {
  const s = snapshot({ A_CYC_MACHINE_MODEL: 250, A_CYC_UUID0: 0, A_CYC_UUID1: 0 });
  assert.equal(s.info.model, null);
  assert.ok(s.info.uuid);
  const blank = {};
  for (let i = 0; i < 8; i += 1) blank[`A_CYC_UUID${i}`] = 0;
  assert.equal(snapshot(blank).info.uuid, null);
});

test('only the active alarms of the fault log are reported', () => {
  const alarms = activeAlarms({
    A_CYC_TOTAL_FAULT_COUNT: 3,
    // Slot 1: filters dirty, mild, active.
    A_CYC_FAULT_CODE: 9,
    A_CYC_FAULT_SEVERITY: 0,
    A_CYC_FAULT_FIRST_DATE: 13000,
    A_CYC_FAULT_LAST_DATE: 13001,
    A_CYC_FAULT_ACTIVITY: 1,
    // Slot 2: solved.
    A_CYC_FAULT_CODE_2: 3,
    A_CYC_FAULT_ACTIVITY_2: 2,
    // Slot 3: supply fan, severe, active.
    A_CYC_FAULT_CODE_3: 2,
    A_CYC_FAULT_SEVERITY_3: 1,
    A_CYC_FAULT_ACTIVITY_3: 1,
  });
  assert.deepEqual(
    alarms.map(({ slot, key, severity }) => ({ slot, key, severity })),
    [
      { slot: 1, key: 'filters_dirty', severity: 'mild' },
      { slot: 3, key: 'supply_fan', severity: 'severe' },
    ],
  );
  // Days counted from 1990-04-08.
  assert.equal(alarms[0].first_date, '2025-11-10');
});

test('temperatures are rounded to one decimal', () => {
  assert.equal(snapshot({ A_CYC_TEMP_SUPPLY_AIR: toKelvin(19.46) + 4 }).temperatures.supply, 19.5);
});

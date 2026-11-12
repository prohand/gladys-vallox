// -----------------------------------------------------------------------------
// From raw registers to what a person understands: a snapshot of the unit.
//
// Everything Gladys shows — features, widget, scene triggers — is computed
// from this snapshot, so the register quirks live here only:
//   - temperatures are hundredths of a kelvin (0 = no sensor);
//   - 0xFFFF is "no value", except in the profile timers where it is "no
//     time limit";
//   - the profile is not a register: a running boost/fireplace/extra timer
//     wins over A_CYC_STATE (home / away);
//   - A_CYC_MODE 5 is "stopped" (the unit's on/off switch), 0 is normal.
// -----------------------------------------------------------------------------

import { NO_VALUE, toCelsius } from './protocol.js';
import { BUILT_IN_ADDRESSES, FAULT_SLOTS, faultRegister } from './model.js';

export const PROFILES = {
  HOME: 'home',
  AWAY: 'away',
  BOOST: 'boost',
  FIREPLACE: 'fireplace',
  EXTRA: 'extra',
};

export const MODE = { NORMAL: 0, OFF: 5 };

export const CELL_STATES = ['heat_recovery', 'cool_recovery', 'bypass', 'defrost'];

// The timers that mean "no time limit" when they read 0xFFFF.
const TIMERS = ['A_CYC_BOOST_TIMER', 'A_CYC_FIREPLACE_TIMER', 'A_CYC_EXTRA_TIMER'];

// Every register the snapshot reads.
export const REGISTERS = Object.keys(BUILT_IN_ADDRESSES);

// Machine models, indexed by A_CYC_MACHINE_MODEL (the list of the unit's own
// web interface).
const MODELS = [
  null,
  'Vallox 096 MV',
  'Vallox 110 MV',
  'Vallox 145 MV',
  'Vallox 245 MV',
  'ValloPlus 270 MV',
  'ValloPlus 350 MV',
  'ValloPlus 510 MV',
  'ValloPlus 850 MV',
  'Vallox TSK Multi 50 MV',
  'Vallox TSK Multi 80 MV',
  'ValloMulti 200 MV',
  'ValloMulti 300 MV',
  'DV96 Adroit',
  'DV110 Adroit',
  'DV145 Adroit',
  'DV245 Adroit',
  'DV TSK Multi 50 Adroit',
  'DV TSK Multi 80 Adroit',
  'ValloPlus 350 MV-E',
  'Aito kotilämpökone',
  'Vallox 90 MV',
  'Vallox 90K MV',
  'ValloPlus 240 MV',
  'ValloPlus 240-K MV',
  'ValloPlus 240-E MV',
  'DV90 Adroit',
  'DV90K Adroit',
  'Vallox 101 MV',
  'ValloPlus 270 MV-E',
  'ValloPlus 510 MV-E',
  'ValloPlus 850 MV-E',
  'ValloMulti 200 MV-E',
  'ValloMulti 300 MV-E',
  'Vallox 51 MV',
  'Vallox 51K MV',
  'ValloPlus 180 MV',
  'ValloPlus 180-K MV',
  'ValloPlus 180-E MV',
  'DV51 Adroit',
  'DV51K Adroit',
  'KWL 170 W',
  'KWL 170 W ET',
  'KWL 200 W R',
  'KWL 200 W L',
  'KWL 200 W ET R',
  'KWL 200 W ET L',
  'KWL 300 W R',
  'KWL 300 W L',
  'KWL 300 W ET R',
  'KWL 300 W ET L',
  'KWL 500 W R',
  'KWL 500 W L',
  'KWL 500 W ET R',
  'KWL 500 W ET L',
  'KWL 220 D R',
  'KWL 220 D L',
  'KWL 340 D R',
  'KWL 340 D L',
  'KWL 360 W',
  'KWL 360 W ET',
  'KWL 250 W',
  'KWL 250 W ET',
  'KWL 470 W',
  'KWL 470 W ET',
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  'TSK Multi 50 MV-E',
  'TSK Multi 80 MV-E',
  'Vallox 096 MV-E',
  'Vallox 110 MV-E',
  'Vallox 145 MV-E',
  'Vallox 245 MV-E',
  'Vallox 51 MV-E',
  'Vallox 101 MV-E',
  'Vallox 139 MV',
  'Vallox 139 MV-E',
  'DV 139 adroit',
  'Vallox 99 MV',
  'Vallox 99 MV CF',
  'ValloPlus 370 MV',
  'ValloPlus 370 MV-E',
  'Vallox 125 MV',
  'KWL 890 W L',
  'KWL 890 W R',
  'KWL 890 W ET L',
  'KWL 890 W ET R',
];

// Fault codes, as the unit's web interface names them.
export const ALARM_CODES = {
  1: 'extract_fan',
  2: 'supply_fan',
  3: 'cell_frozen',
  4: 'temp_sensor_1',
  5: 'temp_sensor_2',
  6: 'temp_sensor_3',
  7: 'temp_sensor_4',
  8: 'temp_sensor_5',
  9: 'filters_dirty',
  10: 'external_sensor',
  11: 'post_heater',
  12: 'liquid_radiator_freezing',
  13: 'duct_sensor_1',
  14: 'stb2_module_1',
  15: 'duct_sensor_2',
  16: 'stb2_module_2',
  17: 'stb1_module_1',
  18: 'stb1_module_2',
  19: 'water_sensor_1',
  20: 'water_sensor_2',
  21: 'water_temperature_1',
  22: 'water_temperature_2',
  23: 'supply_too_low',
  24: 'communication',
};

export const ALARM_SEVERITIES = { 0: 'mild', 1: 'severe' };
const ALARM_ACTIVITY = { PASSIVE: 0, ACTIVE: 1, SOLVED: 2 };

// Fault dates are counted in days from 1990-04-08.
const FAULT_EPOCH = Date.UTC(1990, 3, 8);

function value(raw, name) {
  const v = raw[name];
  if (v === undefined) return null;
  if (v === NO_VALUE && !TIMERS.includes(name)) return null;
  return v;
}

function swap16(word) {
  return ((word & 0xff) << 8) | ((word >> 8) & 0xff);
}

function softwareVersion(raw) {
  const parts = [];
  for (let i = 1; i <= 9; i += 1) {
    const word = value(raw, `A_CYC_APPL_SW_VERSION_${i}`);
    if (word === null) return null;
    parts.push(String(swap16(word)));
  }
  // The firmware pads the version with leading zero words: "0.0.0.0.0.0.2.0.16".
  const version = parts.join('.').replace(/^[.0]+/, '');
  return version || null;
}

function uuid(raw) {
  const words = [];
  for (let i = 0; i < 8; i += 1) {
    const word = raw[`A_CYC_UUID${i}`];
    if (word === undefined) return null;
    words.push(word.toString(16).padStart(4, '0'));
  }
  const hex = words.join('');
  if (/^0+$/.test(hex) || /^f+$/.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function profileOf(raw) {
  if (value(raw, 'A_CYC_BOOST_TIMER') > 0) return PROFILES.BOOST;
  if (value(raw, 'A_CYC_FIREPLACE_TIMER') > 0) return PROFILES.FIREPLACE;
  if (value(raw, 'A_CYC_EXTRA_TIMER') > 0) return PROFILES.EXTRA;
  return value(raw, 'A_CYC_STATE') === 1 ? PROFILES.AWAY : PROFILES.HOME;
}

function timeLeft(raw, profile) {
  const register = {
    [PROFILES.BOOST]: 'A_CYC_BOOST_TIMER',
    [PROFILES.FIREPLACE]: 'A_CYC_FIREPLACE_TIMER',
    [PROFILES.EXTRA]: 'A_CYC_EXTRA_TIMER',
  }[profile];
  if (!register) return 0;
  const minutes = value(raw, register);
  // 0xFFFF: the profile runs until it is stopped.
  return minutes === NO_VALUE ? null : minutes;
}

function faultDate(days) {
  if (days === null) return null;
  return new Date(FAULT_EPOCH + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The alarms of the fault log that are still active.
 * @param {Record<string, number>} raw
 */
export function activeAlarms(raw) {
  const count = Math.min(value(raw, 'A_CYC_TOTAL_FAULT_COUNT') ?? 0, FAULT_SLOTS);
  const alarms = [];
  for (let slot = 1; slot <= count; slot += 1) {
    const code = value(raw, faultRegister('CODE', slot));
    if (code === null || code === 0) continue;
    if (value(raw, faultRegister('ACTIVITY', slot)) !== ALARM_ACTIVITY.ACTIVE) continue;
    alarms.push({
      slot,
      code,
      key: ALARM_CODES[code] ?? 'unknown',
      severity: ALARM_SEVERITIES[value(raw, faultRegister('SEVERITY', slot))] ?? 'unknown',
      first_date: faultDate(value(raw, faultRegister('FIRST_DATE', slot))),
      last_date: faultDate(value(raw, faultRegister('LAST_DATE', slot))),
    });
  }
  return alarms;
}

function filterDates(raw) {
  const day = value(raw, 'A_CYC_FILTER_CHANGED_DAY');
  const month = value(raw, 'A_CYC_FILTER_CHANGED_MONTH');
  const year = value(raw, 'A_CYC_FILTER_CHANGED_YEAR');
  const interval = value(raw, 'A_CYC_FILTER_CHANGE_INTERVAL');
  if (!day || !month || year === null) return { changed: null, next: null };
  const changed = Date.UTC(2000 + year, month - 1, day);
  return {
    changed: new Date(changed).toISOString().slice(0, 10),
    next: interval ? new Date(changed + interval * 86_400_000).toISOString().slice(0, 10) : null,
  };
}

/**
 * The snapshot of a unit, from its raw registers.
 * @param {Record<string, number>} raw register name -> raw word
 */
export function toSnapshot(raw) {
  const profile = profileOf(raw);
  const mode = value(raw, 'A_CYC_MODE');
  const cell = value(raw, 'A_CYC_CELL_STATE');
  const co2 = value(raw, 'A_CYC_CO2_VALUE');
  const humidity = value(raw, 'A_CYC_RH_VALUE');
  const modelIndex = value(raw, 'A_CYC_MACHINE_MODEL');
  const filter = filterDates(raw);
  return {
    info: {
      uuid: uuid(raw),
      model: (modelIndex !== null && MODELS[modelIndex]) || null,
      sw_version: softwareVersion(raw),
    },
    profile,
    // A_CYC_STATE alone: what the unit goes back to once a timed profile ends.
    away: value(raw, 'A_CYC_STATE') === 1,
    boost: profile === PROFILES.BOOST,
    fireplace: profile === PROFILES.FIREPLACE,
    on: mode === null ? null : mode !== MODE.OFF,
    profile_time_left: timeLeft(raw, profile),
    fan_speed: value(raw, 'A_CYC_FAN_SPEED'),
    extract_fan_rpm: value(raw, 'A_CYC_EXTR_FAN_SPEED'),
    supply_fan_rpm: value(raw, 'A_CYC_SUPP_FAN_SPEED'),
    temperatures: {
      extract: toCelsius(value(raw, 'A_CYC_TEMP_EXTRACT_AIR')),
      exhaust: toCelsius(value(raw, 'A_CYC_TEMP_EXHAUST_AIR')),
      outdoor: toCelsius(value(raw, 'A_CYC_TEMP_OUTDOOR_AIR')),
      supply: toCelsius(value(raw, 'A_CYC_TEMP_SUPPLY_AIR')),
      supply_cell: toCelsius(value(raw, 'A_CYC_TEMP_SUPPLY_CELL_AIR')),
    },
    // 0 is what a unit without the sensor reports.
    humidity: humidity || null,
    co2: co2 || null,
    speeds: {
      home: value(raw, 'A_CYC_HOME_SPEED_SETTING'),
      away: value(raw, 'A_CYC_AWAY_SPEED_SETTING'),
      boost: value(raw, 'A_CYC_BOOST_SPEED_SETTING'),
    },
    targets: {
      home: toCelsius(value(raw, 'A_CYC_HOME_AIR_TEMP_TARGET')),
      away: toCelsius(value(raw, 'A_CYC_AWAY_AIR_TEMP_TARGET')),
      boost: toCelsius(value(raw, 'A_CYC_BOOST_AIR_TEMP_TARGET')),
    },
    default_durations: {
      boost: value(raw, 'A_CYC_BOOST_TIME'),
      fireplace: value(raw, 'A_CYC_FIREPLACE_TIME'),
      extra: value(raw, 'A_CYC_EXTRA_TIME'),
    },
    cell_state: cell === null ? null : (CELL_STATES[cell] ?? null),
    filter_days_left: value(raw, 'A_CYC_REMAINING_TIME_FOR_FILTER'),
    filter_changed: filter.changed,
    filter_next_change: filter.next,
    filter_interval: value(raw, 'A_CYC_FILTER_CHANGE_INTERVAL'),
    alarms: activeAlarms(raw),
  };
}

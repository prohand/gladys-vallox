// -----------------------------------------------------------------------------
// The Gladys device of a Vallox unit: its features, its states, its commands.
//
// One unit = one Gladys device, identified by the UUID the unit carries in its
// own registers (never the IP address, which DHCP may change): external ids
// are forever, Gladys keys the history, scenes and dashboards on them.
//
// Feature keys are forever too: never rename one.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { MODE, PROFILES } from '../vallox/metrics.js';

export const DEVICE_TYPE = 'vallox';

// Bounds of the unit's own web interface.
const TARGET_TEMPERATURE = { min: 5, max: 25 };
const PERCENT = { min: 0, max: 100 };
const BINARY = { min: 0, max: 1 };

const temperature = (key, name, read) => ({
  key,
  name,
  category: CATEGORIES.TEMPERATURE_SENSOR,
  type: TYPES.SENSOR.DECIMAL,
  unit: UNITS.CELSIUS,
  min: -50,
  max: 100,
  read,
});

const fanSpeed = (profile, name) => ({
  key: `${profile}-fan-speed`,
  name,
  category: CATEGORIES.FAN,
  type: TYPES.FAN.PERCENT,
  unit: UNITS.PERCENT,
  ...PERCENT,
  writable: true,
  read: (s) => s.speeds[profile],
  write: (value) => ({ [`A_CYC_${profile.toUpperCase()}_SPEED_SETTING`]: clampTo(value, PERCENT) }),
});

const targetTemperature = (profile, name) => ({
  key: `${profile}-target-temperature`,
  name,
  category: CATEGORIES.THERMOSTAT,
  type: TYPES.THERMOSTAT.TARGET_TEMPERATURE,
  unit: UNITS.CELSIUS,
  ...TARGET_TEMPERATURE,
  writable: true,
  read: (s) => s.targets[profile],
  write: (value) => ({
    [`A_CYC_${profile.toUpperCase()}_AIR_TEMP_TARGET`]: clampTo(value, TARGET_TEMPERATURE),
  }),
});

function clampTo(value, { min, max }) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Invalid value ${value}`);
  }
  return Math.min(max, Math.max(min, number));
}

const bool = (value) => (value === null || value === undefined ? null : value ? 1 : 0);

/**
 * The registers that put a unit in a profile. A timed profile (boost,
 * fireplace) runs for `minutes`, the unit's own default when not given;
 * home and away stop any timed profile.
 * @param {string} profile one of PROFILES
 * @param {object} snapshot current snapshot (for the default durations)
 * @param {number} [minutes]
 */
export function profileRegisters(profile, snapshot, minutes) {
  const clear = { A_CYC_BOOST_TIMER: 0, A_CYC_FIREPLACE_TIMER: 0, A_CYC_EXTRA_TIMER: 0 };
  const duration = (kind) => {
    const asked = Number(minutes);
    if (Number.isInteger(asked) && asked > 0) return Math.min(asked, 65535);
    return snapshot?.default_durations?.[kind] || 30;
  };
  switch (profile) {
    case PROFILES.HOME:
      return { ...clear, A_CYC_STATE: 0 };
    case PROFILES.AWAY:
      return { ...clear, A_CYC_STATE: 1 };
    case PROFILES.BOOST:
      return { ...clear, A_CYC_BOOST_TIMER: duration('boost') };
    case PROFILES.FIREPLACE:
      return { ...clear, A_CYC_FIREPLACE_TIMER: duration('fireplace') };
    case PROFILES.EXTRA:
      return { ...clear, A_CYC_EXTRA_TIMER: duration('extra') };
    default:
      throw new Error(`Unknown profile "${profile}"`);
  }
}

// The features, in the order Gladys shows them.
export const FEATURES = [
  {
    key: 'power',
    name: 'Ventilation on/off',
    category: CATEGORIES.SWITCH,
    type: TYPES.SWITCH.BINARY,
    ...BINARY,
    writable: true,
    read: (s) => bool(s.on),
    write: (value) => ({ A_CYC_MODE: Number(value) === 1 ? MODE.NORMAL : MODE.OFF }),
  },
  {
    key: 'away',
    name: 'Away mode',
    category: CATEGORIES.SWITCH,
    type: TYPES.SWITCH.BINARY,
    ...BINARY,
    writable: true,
    read: (s) => bool(s.away),
    // The base state only: a running boost or fireplace keeps going.
    write: (value) => ({ A_CYC_STATE: Number(value) === 1 ? 1 : 0 }),
  },
  {
    key: 'boost',
    name: 'Boost',
    category: CATEGORIES.SWITCH,
    type: TYPES.SWITCH.BINARY,
    ...BINARY,
    writable: true,
    read: (s) => bool(s.boost),
    write: (value, snapshot) =>
      Number(value) === 1 ? profileRegisters(PROFILES.BOOST, snapshot) : { A_CYC_BOOST_TIMER: 0 },
  },
  {
    key: 'fireplace',
    name: 'Fireplace mode',
    category: CATEGORIES.SWITCH,
    type: TYPES.SWITCH.BINARY,
    ...BINARY,
    writable: true,
    read: (s) => bool(s.fireplace),
    write: (value, snapshot) =>
      Number(value) === 1
        ? profileRegisters(PROFILES.FIREPLACE, snapshot)
        : { A_CYC_FIREPLACE_TIMER: 0 },
  },
  {
    key: 'fan-speed',
    name: 'Fan speed',
    category: CATEGORIES.FAN,
    type: TYPES.FAN.PERCENT,
    unit: UNITS.PERCENT,
    ...PERCENT,
    read: (s) => s.fan_speed,
  },
  temperature('extract-temperature', 'Indoor air (extract)', (s) => s.temperatures.extract),
  temperature('outdoor-temperature', 'Outdoor air', (s) => s.temperatures.outdoor),
  temperature('supply-temperature', 'Supply air', (s) => s.temperatures.supply),
  temperature('exhaust-temperature', 'Exhaust air', (s) => s.temperatures.exhaust),
  {
    key: 'humidity',
    name: 'Humidity',
    category: CATEGORIES.HUMIDITY_SENSOR,
    type: TYPES.SENSOR.DECIMAL,
    unit: UNITS.PERCENT,
    ...PERCENT,
    read: (s) => s.humidity,
  },
  {
    key: 'co2',
    name: 'CO2',
    category: CATEGORIES.CO2_SENSOR,
    type: TYPES.SENSOR.INTEGER,
    unit: UNITS.PPM,
    min: 0,
    max: 5000,
    read: (s) => s.co2,
  },
  fanSpeed('home', 'Fan speed (home)'),
  fanSpeed('away', 'Fan speed (away)'),
  fanSpeed('boost', 'Fan speed (boost)'),
  targetTemperature('home', 'Supply air target (home)'),
  targetTemperature('away', 'Supply air target (away)'),
  targetTemperature('boost', 'Supply air target (boost)'),
  {
    key: 'profile-time-left',
    name: 'Boost / fireplace time left',
    category: CATEGORIES.DURATION,
    type: TYPES.DURATION.INTEGER,
    unit: UNITS.MINUTES,
    min: 0,
    max: 65535,
    read: (s) => s.profile_time_left,
  },
  {
    key: 'filter-days-left',
    name: 'Filter change in',
    category: CATEGORIES.DURATION,
    type: TYPES.DURATION.INTEGER,
    unit: UNITS.DAYS,
    min: 0,
    max: 1000,
    read: (s) => s.filter_days_left,
  },
];

const FEATURES_BY_KEY = new Map(FEATURES.map((feature) => [feature.key, feature]));

/** The external ids of a unit's device, from its UUID. */
export function unitIds(gladys, uuid) {
  return gladys.externalIds(DEVICE_TYPE, uuid);
}

/**
 * The discovery payload of a unit.
 * @param {object} gladys SDK client
 * @param {{ host: string, uuid: string, model?: string|null, sw_version?: string|null }} unit
 * @param {{ withHost?: boolean }} [options] add the address to the name (several units)
 */
export function buildDevice(gladys, unit, { withHost = false } = {}) {
  const ids = unitIds(gladys, unit.uuid);
  const base = unit.model || 'Vallox';
  return {
    name: withHost ? `${base} (${unit.host})` : base,
    external_id: ids.device,
    // Read by the integration's own timer (index.js), not by Gladys.
    should_poll: false,
    params: [
      { name: 'host', value: unit.host },
      ...(unit.sw_version ? [{ name: 'firmware', value: unit.sw_version }] : []),
    ],
    features: FEATURES.map((feature) => ({
      name: feature.name,
      external_id: ids.feature(feature.key),
      category: feature.category,
      type: feature.type,
      ...(feature.unit ? { unit: feature.unit } : {}),
      min: feature.min,
      max: feature.max,
      read_only: !feature.writable,
      has_feedback: Boolean(feature.writable),
      keep_history: true,
    })),
  };
}

/**
 * The states of a unit's features, for publishChangedStates. A value the
 * unit does not report (no CO2 sensor...) is not published.
 */
export function buildStates(gladys, uuid, snapshot) {
  const ids = unitIds(gladys, uuid);
  return FEATURES.flatMap((feature) => {
    const state = feature.read(snapshot);
    return state === null || state === undefined || !Number.isFinite(state)
      ? []
      : [{ device_feature_external_id: ids.feature(feature.key), state }];
  });
}

/**
 * The feature key of a feature external id of the unit, or null.
 */
export function featureKeyOf(gladys, uuid, featureExternalId) {
  const prefix = `${unitIds(gladys, uuid).device}:`;
  return featureExternalId.startsWith(prefix) ? featureExternalId.slice(prefix.length) : null;
}

/**
 * The registers a command on a feature writes.
 * @param {string} featureKey
 * @param {number} value value sent by Gladys
 * @param {object} snapshot current snapshot of the unit
 */
export function commandRegisters(featureKey, value, snapshot) {
  const feature = FEATURES_BY_KEY.get(featureKey);
  if (!feature?.writable) {
    throw new Error(`Feature "${featureKey}" cannot be controlled`);
  }
  return feature.write(value, snapshot);
}

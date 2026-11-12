// -----------------------------------------------------------------------------
// Scene actions (Gladys 5.1+): operations a scene author puts in a scene.
//
// Each key is declared in the manifest `scene_actions` field and handled here;
// index.js registers every entry with `gladys.onSceneAction(key, ...)`.
// `fields` arrive RESOLVED (scene variables substituted, defaults applied);
// a `"source": "devices"` field is the chosen device external_id. The resolved
// object holds the declared `outputs` (scalars only).
//
// The scene TRIGGERS are fired by src/units.js, on the transitions it sees
// between two reads. An order given here is remembered there so its own
// profile change never fires `profile_changed` (no loop through a scene).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { PROFILES } from '../vallox/metrics.js';
import { profileRegisters } from '../devices/ventilation.js';

const logger = createLogger({ name: 'scenes' });

// The profiles a scene (and the widget) can switch to.
export const SETTABLE_PROFILES = [PROFILES.HOME, PROFILES.AWAY, PROFILES.BOOST, PROFILES.FIREPLACE];
export const SPEED_PROFILES = [PROFILES.HOME, PROFILES.AWAY, PROFILES.BOOST];

/**
 * Switch a unit to a profile, then read it back.
 * @returns {Promise<string>} the profile the unit reports afterwards
 */
export async function setProfile(units, unit, profile, minutes) {
  if (!SETTABLE_PROFILES.includes(profile)) {
    throw new Error(`Unknown profile "${profile}"`);
  }
  const registers = profileRegisters(profile, unit.snapshot, minutes);
  const snapshot = await units.command(unit, registers, { profile });
  return snapshot?.profile ?? profile;
}

/**
 * Record a filter change made today: the unit counts its next reminder from
 * that date.
 * @returns {Promise<string|null>} the next change date (YYYY-MM-DD)
 */
export async function resetFilterReminder(units, unit, today = new Date()) {
  const snapshot = await units.command(unit, {
    A_CYC_FILTER_CHANGED_DAY: today.getDate(),
    A_CYC_FILTER_CHANGED_MONTH: today.getMonth() + 1,
    A_CYC_FILTER_CHANGED_YEAR: today.getFullYear() - 2000,
  });
  return snapshot?.filter_next_change ?? null;
}

// Outputs are scalars: an absent value is left out rather than sent as null.
function scalars(values) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== null && value !== undefined),
  );
}

export const SCENE_ACTIONS = {
  async set_profile(units, fields) {
    logger.info(`Scene action set_profile <- ${fields.profile}`);
    const unit = units.resolve(fields.device);
    return { profile: await setProfile(units, unit, fields.profile, fields.duration) };
  },

  async set_fan_speed(units, fields) {
    logger.info(`Scene action set_fan_speed <- ${fields.profile} ${fields.speed} %`);
    if (!SPEED_PROFILES.includes(fields.profile)) {
      throw new Error(`Unknown profile "${fields.profile}"`);
    }
    const speed = Math.round(Number(fields.speed));
    if (!Number.isFinite(speed) || speed < 0 || speed > 100) {
      throw new Error(`Invalid fan speed ${fields.speed}`);
    }
    const unit = units.resolve(fields.device);
    await units.command(unit, { [`A_CYC_${fields.profile.toUpperCase()}_SPEED_SETTING`]: speed });
    return { speed };
  },

  async reset_filter_reminder(units, fields) {
    logger.info('Scene action reset_filter_reminder');
    const unit = units.resolve(fields.device);
    return scalars({ next_change: await resetFilterReminder(units, unit) });
  },

  async read_values(units, fields) {
    const unit = units.resolve(fields.device);
    const snapshot = await units.refreshUnit(unit);
    if (!snapshot) {
      throw new Error(`No answer from ${unit.host}`);
    }
    return scalars({
      profile: snapshot.profile,
      indoor_temperature: snapshot.temperatures.extract,
      outdoor_temperature: snapshot.temperatures.outdoor,
      supply_temperature: snapshot.temperatures.supply,
      humidity: snapshot.humidity,
      co2: snapshot.co2,
      fan_speed: snapshot.fan_speed,
      filter_days_left: snapshot.filter_days_left,
    });
  },
};

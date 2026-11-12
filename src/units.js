// -----------------------------------------------------------------------------
// The units the integration drives, and everything Gladys sees of them.
//
// One `Units` instance holds every configured unit (one per address typed in
// the configuration) and is the only place that talks to both sides:
//
//   Vallox unit  --read/write-->  Units  --states, devices, transports,
//                                         scene events, widget nudges-->  Gladys
//
// A refresh reads every unit, publishes what changed, and compares the new
// snapshot with the previous one to fire the scene triggers on TRANSITIONS
// only (one event per change, never one per read).
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { ValloxClient } from './vallox/client.js';
import { buildDevice, buildStates, unitIds } from './devices/ventilation.js';
import { localize, pick } from './i18n.js';

const logger = createLogger({ name: 'units' });

// Scene trigger keys, as declared in the manifest. Keys are forever.
export const TRIGGERS = {
  PROFILE_CHANGED: 'profile_changed',
  ALARM_RAISED: 'alarm_raised',
  FILTER_CHANGE_DUE: 'filter_change_due',
  UNIT_UNREACHABLE: 'unit_unreachable',
};

// Dashboard widget key, as declared in the manifest. Keys are forever.
export const VENTILATION_WIDGET = 'ventilation';

// A unit is declared unreachable after this many failed reads in a row: one
// lost answer on a Wi-Fi link is not worth a scene.
export const FAILURES_BEFORE_UNREACHABLE = 2;

// How long an order given by Gladys keeps its own profile change from firing
// `profile_changed` (no loop through a scene bound to the trigger).
const OWN_ORDER_MS = 2 * 60_000;

// Unchanged values are re-sent this often, so they stay recently dated.
const HEARTBEAT_MS = 30 * 60_000;

// English texts of the alarms, for the `message` variable of the trigger
// (scene variables carry one language).
export const ALARM_TEXTS = {
  extract_fan: 'Extract air fan fault',
  supply_fan: 'Supply air fan fault',
  cell_frozen: 'Heat recovery cell frozen',
  temp_sensor_1: 'Temperature sensor 1 fault',
  temp_sensor_2: 'Temperature sensor 2 fault',
  temp_sensor_3: 'Temperature sensor 3 fault',
  temp_sensor_4: 'Temperature sensor 4 fault',
  temp_sensor_5: 'Temperature sensor 5 fault',
  filters_dirty: 'Filters dirty',
  external_sensor: 'External sensor fault',
  post_heater: 'Post-heater fault',
  liquid_radiator_freezing: 'Liquid radiator freezing risk',
  duct_sensor_1: 'Duct temperature sensor, module 1',
  stb2_module_1: 'STB 2, module 1',
  duct_sensor_2: 'Duct temperature sensor, module 2',
  stb2_module_2: 'STB 2, module 2',
  stb1_module_1: 'STB 1, module 1',
  stb1_module_2: 'STB 1, module 2',
  water_sensor_1: 'Water temperature sensor, module 1',
  water_sensor_2: 'Water temperature sensor, module 2',
  water_temperature_1: 'Water temperature, module 1',
  water_temperature_2: 'Water temperature, module 2',
  supply_too_low: 'Supply air temperature too low',
  communication: 'Communication error',
  unknown: 'Unknown alarm',
};

/**
 * One configured unit: its client, what is known of it, its last snapshot.
 */
class Unit {
  constructor(host, client, cached) {
    this.host = host;
    this.client = client;
    this.uuid = cached?.uuid ?? null;
    this.model = cached?.model ?? null;
    this.sw_version = cached?.sw_version ?? null;
    this.snapshot = null;
    this.reachable = null; // unknown until the first read
    this.failures = 0;
    this.lastError = null;
    this.lastRead = null;
    this.ownOrder = null; // { profile, until }
  }
}

export class Units {
  /**
   * @param {object} gladys SDK client
   * @param {object} [options]
   * @param {import('./vallox/store.js').UnitStore} [options.store]
   * @param {(host: string) => ValloxClient} [options.createClient]
   * @param {() => number} [options.now]
   */
  constructor(gladys, options = {}) {
    this.gladys = gladys;
    this.store = options.store ?? null;
    this.createClient = options.createClient ?? ((host) => new ValloxClient(host));
    this.now = options.now ?? Date.now;
    this.units = new Map(); // host -> Unit
    this.cache = {};
    this.config = null;
    this.timer = null;
    this.refreshing = null;
    this.widgetSignature = null;
  }

  /** Read the cache of the units already met (once, at startup). */
  async restore() {
    this.cache = (await this.store?.load()) ?? {};
  }

  /**
   * Apply a configuration: one unit per address. A unit whose address did
   * not change keeps its client and its last snapshot.
   */
  configure(config) {
    this.config = config;
    const wanted = new Set(config.host_list);
    for (const host of this.units.keys()) {
      if (!wanted.has(host)) this.units.delete(host);
    }
    for (const host of config.host_list) {
      if (!this.units.has(host)) {
        this.units.set(host, new Unit(host, this.createClient(host), this.cache[host]));
      }
    }
  }

  list() {
    return [...this.units.values()];
  }

  /** The units Gladys knows a device of (UUID known). */
  identified() {
    const seen = new Set();
    return this.list().filter((unit) => {
      if (!unit.uuid || seen.has(unit.uuid)) return false;
      seen.add(unit.uuid);
      return true;
    });
  }

  /** The unit of a Gladys device external id (or of a feature of it). */
  findByExternalId(externalId) {
    if (typeof externalId !== 'string') return undefined;
    return this.identified().find((unit) => {
      const device = unitIds(this.gladys, unit.uuid).device;
      return externalId === device || externalId.startsWith(`${device}:`);
    });
  }

  /**
   * The unit a scene, an action or a widget points at: the chosen device, or
   * the only unit when nothing was chosen.
   */
  resolve(externalId) {
    if (externalId) {
      const unit = this.findByExternalId(externalId);
      if (!unit) throw new Error(`Unknown Vallox device ${externalId}`);
      return unit;
    }
    const units = this.identified();
    if (units.length === 1) return units[0];
    throw new Error(
      units.length === 0 ? 'No Vallox unit is known yet' : 'Several Vallox units: choose one',
    );
  }

  /** The name of the unit's device in Gladys (renamed by the user or not). */
  deviceName(unit) {
    const ids = unitIds(this.gladys, unit.uuid);
    const created = (this.gladys.devices ?? []).find((d) => d.external_id === ids.device);
    const withHost = this.identified().length > 1;
    return created?.name ?? buildDevice(this.gladys, unit, { withHost }).name;
  }

  discoveredDevices() {
    const units = this.identified();
    return units.map((unit) => buildDevice(this.gladys, unit, { withHost: units.length > 1 }));
  }

  async publishDevices() {
    await this.gladys.publishDiscoveredDevices(this.discoveredDevices());
  }

  transportEntries() {
    return this.identified().map((unit) => {
      if (unit.reachable === false) {
        return {
          external_id: unitIds(this.gladys, unit.uuid).device,
          transport: DEVICE_TRANSPORTS.UNREACHABLE,
        };
      }
      return {
        external_id: unitIds(this.gladys, unit.uuid).device,
        transport: DEVICE_TRANSPORTS.LOCAL,
      };
    });
  }

  async publishTransports() {
    const entries = this.transportEntries();
    if (entries.length > 0) {
      await this.gladys.publishTransports(entries);
    }
  }

  /** The application status shown in the Configuration screen. */
  async publishConnectionStatus() {
    const units = this.list();
    if (units.length === 0) {
      await this.gladys.setConnectionStatus(false, {
        en: 'Enter the IP address of your Vallox unit.',
        fr: "Saisissez l'adresse IP de votre centrale Vallox.",
        de: 'Gib die IP-Adresse deines Vallox-Geräts ein.',
        es: 'Introduzca la dirección IP de su unidad Vallox.',
      });
      return;
    }
    const down = units.filter((unit) => unit.reachable === false);
    if (down.length === 0) {
      await this.gladys.setConnectionStatus(true);
      return;
    }
    const hosts = down.map((unit) => unit.host).join(', ');
    await this.gladys.setConnectionStatus(
      false,
      localize((language) =>
        pick(language, {
          en: `No answer from ${hosts}.`,
          fr: `Pas de réponse de ${hosts}.`,
          de: `Keine Antwort von ${hosts}.`,
          es: `Sin respuesta de ${hosts}.`,
        }),
      ),
    );
  }

  /**
   * Read every unit, publish what changed, fire the triggers. Concurrent
   * calls share the same run.
   * @returns {Promise<void>}
   */
  refreshAll() {
    if (!this.refreshing) {
      this.refreshing = this.runRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  async runRefresh() {
    const before = new Set(this.identified().map((unit) => unit.uuid));
    const reachability = this.list().map((unit) => unit.reachable);
    await Promise.all(this.list().map((unit) => this.refreshUnit(unit, { publish: false })));

    // A unit identified for the first time (offline at startup, new address):
    // Gladys must learn its device before its states.
    const identified = this.identified();
    if (identified.some((unit) => !before.has(unit.uuid))) {
      await this.persist();
      await this.publishDevices();
    }
    await this.publishStates(identified);
    if (this.list().some((unit, i) => unit.reachable !== reachability[i])) {
      await this.publishTransports();
      await this.publishConnectionStatus();
    }
    this.nudgeWidget();
  }

  /**
   * Read one unit and remember the snapshot. Fires the triggers of the
   * transitions it sees.
   */
  async refreshUnit(unit, { publish = true } = {}) {
    const previous = unit.snapshot;
    const wasReachable = unit.reachable;
    let snapshot;
    try {
      snapshot = await unit.client.readSnapshot();
    } catch (error) {
      unit.failures += 1;
      unit.lastError = error.message;
      logger.warn(`${unit.host}: read failed (${error.message})`);
      if (unit.failures >= FAILURES_BEFORE_UNREACHABLE || unit.reachable === null) {
        unit.reachable = false;
      }
      if (wasReachable === true && unit.reachable === false && unit.uuid) {
        await this.fire(TRIGGERS.UNIT_UNREACHABLE, unit, { host: unit.host });
      }
      if (publish && wasReachable !== unit.reachable) {
        await this.publishTransports();
        await this.publishConnectionStatus();
      }
      return null;
    }

    unit.failures = 0;
    unit.lastError = null;
    unit.reachable = true;
    unit.lastRead = this.now();
    unit.snapshot = snapshot;
    this.learnIdentity(unit, snapshot.info);

    if (previous && unit.uuid) {
      await this.fireTransitions(unit, previous, snapshot);
    }
    if (publish) {
      await this.publishStates([unit]);
      if (wasReachable !== true) {
        await this.publishTransports();
        await this.publishConnectionStatus();
      }
      this.nudgeWidget();
    }
    return snapshot;
  }

  learnIdentity(unit, info) {
    if (!info.uuid) return;
    const clash = this.list().find((other) => other !== unit && other.uuid === info.uuid);
    if (clash && !unit.uuid) {
      logger.warn(`${unit.host} is the same unit as ${clash.host}: it is published once`);
    }
    unit.uuid = info.uuid;
    unit.model = info.model ?? unit.model;
    unit.sw_version = info.sw_version ?? unit.sw_version;
  }

  async persist() {
    if (!this.store) return;
    for (const unit of this.identified()) {
      this.cache[unit.host] = { uuid: unit.uuid, model: unit.model, sw_version: unit.sw_version };
    }
    await this.store.save(this.cache);
  }

  async publishStates(units) {
    const states = units
      .filter((unit) => unit.uuid && unit.snapshot)
      .flatMap((unit) => buildStates(this.gladys, unit.uuid, unit.snapshot));
    if (states.length === 0) return;
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
    } catch (error) {
      // Re-sent by the next refresh: publishChangedStates only remembers the
      // values Gladys accepted.
      logger.warn(`Publishing the states failed: ${error.message}`);
    }
  }

  async fireTransitions(unit, previous, next) {
    if (previous.profile !== next.profile) {
      const own = unit.ownOrder && unit.ownOrder.until > this.now() ? unit.ownOrder : null;
      if (own?.profile === next.profile) {
        unit.ownOrder = null;
      } else {
        await this.fire(TRIGGERS.PROFILE_CHANGED, unit, {
          profile: next.profile,
          previous_profile: previous.profile,
        });
      }
    }

    const known = new Set(previous.alarms.map((alarm) => `${alarm.slot}:${alarm.code}`));
    for (const alarm of next.alarms) {
      if (known.has(`${alarm.slot}:${alarm.code}`)) continue;
      await this.fire(TRIGGERS.ALARM_RAISED, unit, {
        severity: alarm.severity,
        alarm: alarm.key,
        code: alarm.code,
        message: ALARM_TEXTS[alarm.key] ?? ALARM_TEXTS.unknown,
      });
    }

    const threshold = this.config?.filter_warning_days ?? 0;
    if (
      previous.filter_days_left !== null &&
      next.filter_days_left !== null &&
      previous.filter_days_left > threshold &&
      next.filter_days_left <= threshold
    ) {
      await this.fire(TRIGGERS.FILTER_CHANGE_DUE, unit, {
        days_left: next.filter_days_left,
        next_change: next.filter_next_change,
      });
    }
  }

  async fire(key, unit, data) {
    const payload = {
      device: unitIds(this.gladys, unit.uuid).device,
      device_name: this.deviceName(unit),
      ...data,
    };
    try {
      await this.gladys.publishSceneEvent(key, payload);
      logger.info(`${unit.host}: scene event ${key}`);
    } catch (error) {
      logger.warn(`${unit.host}: scene event ${key} refused (${error.message})`);
    }
  }

  /**
   * Write registers on a unit, then read it back so Gladys shows the result
   * right away.
   * @param {object} unit
   * @param {Record<string, number>} registers
   * @param {{ profile?: string }} [intent] the profile this order leads to
   */
  async command(unit, registers, intent = {}) {
    if (intent.profile) {
      unit.ownOrder = { profile: intent.profile, until: this.now() + OWN_ORDER_MS };
    }
    await unit.client.write(registers);
    return this.refreshUnit(unit);
  }

  /** Ask open dashboards to re-pull the widget when what it computes changed. */
  nudgeWidget() {
    const signature = JSON.stringify(
      this.list().map((unit) => [
        unit.host,
        unit.reachable,
        unit.snapshot?.profile,
        unit.snapshot?.cell_state,
        unit.snapshot?.filter_days_left,
        unit.snapshot?.alarms.length,
        unit.snapshot?.on,
      ]),
    );
    if (signature !== this.widgetSignature) {
      this.widgetSignature = signature;
      this.gladys.requestWidgetRefresh(VENTILATION_WIDGET);
    }
  }

  /** Read the units every `poll_frequency` seconds, never two runs at once. */
  start() {
    this.stop();
    const loop = async () => {
      try {
        await this.refreshAll();
      } catch (error) {
        logger.error('Refresh failed', error);
      }
      if (this.timer !== null) {
        this.timer = setTimeout(loop, (this.config?.poll_frequency ?? 60) * 1000);
      }
    };
    this.timer = setTimeout(loop, (this.config?.poll_frequency ?? 60) * 1000);
  }

  stop() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

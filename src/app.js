// -----------------------------------------------------------------------------
// SDK wiring: every Gladys handler, registered before connect().
//
// Kept apart from index.js so the tests drive the real wiring with the SDK's
// fake Gladys (`@gladysassistant/integration-sdk/testing`). No Vallox logic
// here: it lives in src/units.js (reads, publications, triggers) and in the
// modules it calls.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { Units, VENTILATION_WIDGET } from './units.js';
import { commandRegisters, featureKeyOf } from './devices/ventilation.js';
import { PROFILES } from './vallox/metrics.js';
import { SCENE_ACTIONS } from './capabilities/scenes.js';
import { WIDGETS } from './capabilities/widget.js';
import { ACTIONS } from './capabilities/actions.js';

const logger = createLogger({ name: 'app' });

// The profile a switch command leads to, so its own change never fires the
// `profile_changed` trigger.
function intentOf(featureKey, value, snapshot) {
  const on = Number(value) === 1;
  switch (featureKey) {
    case 'boost':
      return { profile: on ? PROFILES.BOOST : snapshot?.away ? PROFILES.AWAY : PROFILES.HOME };
    case 'fireplace':
      return {
        profile: on ? PROFILES.FIREPLACE : snapshot?.away ? PROFILES.AWAY : PROFILES.HOME,
      };
    case 'away':
      // A running boost or fireplace keeps the lead: no visible change.
      return snapshot?.boost || snapshot?.fireplace
        ? {}
        : { profile: on ? PROFILES.AWAY : PROFILES.HOME };
    default:
      return {};
  }
}

/**
 * Register every handler on the SDK client.
 * @param {object} gladys GladysIntegration (or the fake one in tests)
 * @param {{ units?: Units, store?: object, createClient?: Function }} [options]
 * @returns {{ units: Units, getConfig: () => object }}
 */
export function registerHandlers(gladys, options = {}) {
  const units =
    options.units ??
    new Units(gladys, { store: options.store, createClient: options.createClient });
  let config = normalizeConfig();
  let restored = false;

  async function applyConfig(raw) {
    config = normalizeConfig(raw);
    if (!restored) {
      await units.restore();
      restored = true;
    }
    units.configure(config);
    logger.info(`Units configured: ${config.host_list.join(', ') || 'none'}`);
  }

  // Read everything, then tell Gladys what exists and how it is reached.
  async function synchronize() {
    await units.refreshAll();
    await units.publishDevices();
    await units.publishTransports();
    await units.publishConnectionStatus();
    // The nudges sent while the socket was down were dropped: re-sync the
    // open dashboards.
    gladys.requestWidgetRefresh(VENTILATION_WIDGET);
  }

  // --- Discovery ------------------------------------------------------------
  gladys.onScanRequest(async () => {
    logger.info('onScanRequest -> reading the units');
    await units.refreshAll();
    await units.publishDevices();
  });

  // --- Commands from the Gladys interface ------------------------------------
  gladys.onSetValue(async (device, feature, value) => {
    logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
    const unit = units.findByExternalId(device.external_id);
    if (!unit) {
      throw new Error(`Unknown Vallox device ${device.external_id}`);
    }
    const key = featureKeyOf(gladys, unit.uuid, feature.external_id);
    const registers = commandRegisters(key, value, unit.snapshot);
    await units.command(unit, registers, intentOf(key, value, unit.snapshot));
  });

  // --- Manifest actions (Configuration screen) -------------------------------
  for (const [key, handler] of Object.entries(ACTIONS)) {
    gladys.onAction(key, (fields) => handler(units, fields ?? {}));
  }

  // --- Scene actions ----------------------------------------------------------
  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(key, (fields) => handler(units, fields ?? {}));
  }

  // --- Dashboard widget ---------------------------------------------------------
  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(key, (request) => widget.get(gladys, units, { ...request, config }));
    gladys.onWidgetAction(key, (actionKey, params, { settings } = {}) =>
      widget.action(gladys, units, { actionKey, params, settings, config }),
    );
  }

  // --- Configuration changed by the user ------------------------------------------
  gladys.onConfigUpdated(async (newConfig) => {
    logger.info('onConfigUpdated -> new configuration received');
    await applyConfig(newConfig);
    await synchronize();
    units.start();
  });

  // --- Connection lifecycle ---------------------------------------------------------
  gladys.on('connected', async () => {
    try {
      await applyConfig(await gladys.getConfig());
      await synchronize();
      units.start();
    } catch (error) {
      logger.error('Post-connection initialization failed', error);
      await gladys
        .setConnectionStatus(false, {
          en: 'Initialization failed, check the integration logs.',
          fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
          de: 'Die Initialisierung ist fehlgeschlagen, prüfe die Logs der Integration.',
          es: 'La inicialización ha fallado, consulte los registros de la integración.',
        })
        .catch(() => {});
    }
  });

  // No reads while Gladys is away: the states would be lost anyway, and the
  // next connection re-reads everything.
  gladys.on('disconnected', () => units.stop());

  return { units, getConfig: () => config };
}

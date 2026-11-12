// -----------------------------------------------------------------------------
// The "Vallox ventilation" dashboard widget (Gladys 5.1+).
//
// Declared in the manifest `widgets` field; index.js registers `get` with
// `gladys.onWidgetGet` and `action` with `gladys.onWidgetAction`. The content
// is declarative (the core renders it with its own theme):
//   - live tiles bound to the device features (temperatures, humidity, CO2,
//     fan speed): they follow the published states, no nudge needed;
//   - a status list of what no single feature says (profile and time left,
//     heat recovery cell, filter, alarms, connection), re-pulled when
//     src/units.js sees it change (requestWidgetRefresh);
//   - four buttons to switch the profile. Their `params` are declared HERE
//     and come back as they are: never user input.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { unitIds } from '../devices/ventilation.js';
import { PROFILES } from '../vallox/metrics.js';
import { ALARM_TEXTS, VENTILATION_WIDGET } from '../units.js';
import { setProfile } from './scenes.js';

const logger = createLogger({ name: 'widget' });

export { VENTILATION_WIDGET };

// One action key per button (the core refuses two buttons sharing a key):
// `set_<profile>`. Keys are stored in dashboards: never rename them.
export const WIDGET_ACTIONS = {
  set_home: PROFILES.HOME,
  set_away: PROFILES.AWAY,
  set_boost: PROFILES.BOOST,
};

export const PROFILE_LABELS = {
  [PROFILES.HOME]: { en: 'Home', fr: 'Maison', de: 'Zuhause', es: 'En casa' },
  [PROFILES.AWAY]: { en: 'Away', fr: 'Absence', de: 'Abwesend', es: 'Ausente' },
  [PROFILES.BOOST]: { en: 'Boost', fr: 'Boost', de: 'Boost', es: 'Boost' },
  [PROFILES.FIREPLACE]: { en: 'Fireplace', fr: 'Cheminée', de: 'Kamin', es: 'Chimenea' },
  [PROFILES.EXTRA]: { en: 'Extra', fr: 'Extra', de: 'Extra', es: 'Extra' },
};

const PROFILE_COLORS = {
  [PROFILES.HOME]: WIDGET_COLORS.SUCCESS,
  [PROFILES.AWAY]: WIDGET_COLORS.INFO,
  [PROFILES.BOOST]: WIDGET_COLORS.WARNING,
  [PROFILES.FIREPLACE]: WIDGET_COLORS.WARNING,
  [PROFILES.EXTRA]: WIDGET_COLORS.PRIMARY,
};

const PROFILE_ICONS = {
  [PROFILES.HOME]: 'home',
  [PROFILES.AWAY]: 'log-out',
  [PROFILES.BOOST]: 'wind',
  [PROFILES.FIREPLACE]: 'sun',
};

const CELL_LABELS = {
  heat_recovery: {
    en: 'Heat recovery',
    fr: 'Récupération de chaleur',
    de: 'Wärmerückgewinnung',
    es: 'Recuperación de calor',
  },
  cool_recovery: {
    en: 'Cool recovery',
    fr: 'Récupération de fraîcheur',
    de: 'Kälterückgewinnung',
    es: 'Recuperación de frío',
  },
  bypass: { en: 'Bypass', fr: 'Bypass', de: 'Bypass', es: 'Bypass' },
  defrost: { en: 'Defrost', fr: 'Dégivrage', de: 'Abtauen', es: 'Descongelación' },
};

const T = {
  indoor: { en: 'Indoor', fr: 'Intérieur', de: 'Innen', es: 'Interior' },
  outdoor: { en: 'Outdoor', fr: 'Extérieur', de: 'Außen', es: 'Exterior' },
  supply: { en: 'Supply air', fr: 'Air soufflé', de: 'Zuluft', es: 'Aire impulsado' },
  humidity: { en: 'Humidity', fr: 'Humidité', de: 'Feuchte', es: 'Humedad' },
  co2: { en: 'CO2', fr: 'CO2', de: 'CO2', es: 'CO2' },
  fan: { en: 'Fan speed', fr: 'Ventilation', de: 'Lüfterstufe', es: 'Ventilación' },
  profile: { en: 'Profile', fr: 'Profil', de: 'Profil', es: 'Perfil' },
  stopped: { en: 'Stopped', fr: 'Arrêtée', de: 'Gestoppt', es: 'Parada' },
  timeLeft: { en: 'Time left', fr: 'Temps restant', de: 'Restzeit', es: 'Tiempo restante' },
  noLimit: { en: 'No limit', fr: 'Sans limite', de: 'Unbegrenzt', es: 'Sin límite' },
  cell: {
    en: 'Heat exchanger',
    fr: 'Échangeur',
    de: 'Wärmetauscher',
    es: 'Intercambiador',
  },
  filter: {
    en: 'Filter change',
    fr: 'Changement filtre',
    de: 'Filterwechsel',
    es: 'Cambio filtro',
  },
  alarms: { en: 'Alarms', fr: 'Alarmes', de: 'Alarme', es: 'Alarmas' },
  none: { en: 'None', fr: 'Aucune', de: 'Keine', es: 'Ninguna' },
  connection: { en: 'Connection', fr: 'Connexion', de: 'Verbindung', es: 'Conexión' },
  local: { en: 'Local', fr: 'Locale', de: 'Lokal', es: 'Local' },
  unreachable: {
    en: 'Unreachable',
    fr: 'Injoignable',
    de: 'Nicht erreichbar',
    es: 'Inaccesible',
  },
  noUnit: {
    en: 'No Vallox unit yet: enter its IP address in the integration configuration.',
    fr: "Aucune centrale Vallox pour l'instant : saisissez son adresse IP dans la configuration de l'intégration.",
    de: 'Noch kein Vallox-Gerät: Gib seine IP-Adresse in der Konfiguration der Integration ein.',
    es: 'Aún no hay ninguna unidad Vallox: introduzca su dirección IP en la configuración de la integración.',
  },
  notRead: {
    en: 'The unit has not answered yet.',
    fr: "La centrale n'a pas encore répondu.",
    de: 'Das Gerät hat noch nicht geantwortet.',
    es: 'La unidad aún no ha respondido.',
  },
};

const each = (build) => ({ en: build('en'), fr: build('fr'), de: build('de'), es: build('es') });

function minutes(value) {
  if (value === null) return T.noLimit;
  if (value < 60) return `${value} min`;
  return `${Math.floor(value / 60)} h ${String(value % 60).padStart(2, '0')}`;
}

function days(count) {
  return each((l) => {
    const unit = { en: 'days', fr: 'jours', de: 'Tage', es: 'días' }[l];
    return `${count} ${unit}`;
  });
}

// The content budget of a widget is 8 components: 4 tiles (3 with a title),
// 1 status list and 3 buttons fill it exactly.
function tiles(gladys, unit, count) {
  const ids = unitIds(gladys, unit.uuid);
  const s = unit.snapshot;
  const tile = (key, label, icon) => ({
    type: 'value',
    label,
    icon,
    device_feature: ids.feature(key),
  });
  // The air quality tile shows the sensor the unit has, CO2 first.
  let quality = tile('supply-temperature', T.supply, 'arrow-right');
  if (s?.co2 !== null && s?.co2 !== undefined) quality = tile('co2', T.co2, 'activity');
  else if (s?.humidity !== null && s?.humidity !== undefined) {
    quality = tile('humidity', T.humidity, 'droplet');
  }
  return [
    tile('extract-temperature', T.indoor, 'thermometer'),
    tile('outdoor-temperature', T.outdoor, 'cloud'),
    tile('fan-speed', T.fan, 'wind'),
    quality,
  ].slice(0, count);
}

function statusItems(unit, filterWarningDays) {
  const s = unit.snapshot;
  const items = [];
  if (s.on === false) {
    items.push({
      label: T.profile,
      icon: 'power',
      value: T.stopped,
      color: WIDGET_COLORS.NEUTRAL,
    });
  } else {
    items.push({
      label: T.profile,
      icon: PROFILE_ICONS[s.profile] ?? 'sliders',
      value: PROFILE_LABELS[s.profile],
      color: PROFILE_COLORS[s.profile],
    });
  }
  if (s.profile_time_left !== 0) {
    items.push({
      label: T.timeLeft,
      icon: 'clock',
      value: minutes(s.profile_time_left),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (s.cell_state) {
    items.push({
      label: T.cell,
      icon: 'refresh-cw',
      value: CELL_LABELS[s.cell_state],
      color: s.cell_state === 'defrost' ? WIDGET_COLORS.INFO : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (s.filter_days_left !== null) {
    items.push({
      label: T.filter,
      icon: 'filter',
      value: days(s.filter_days_left),
      color:
        s.filter_days_left <= filterWarningDays ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
    });
  }
  items.push({
    label: T.alarms,
    icon: 'alert-triangle',
    value:
      s.alarms.length === 0
        ? T.none
        : s.alarms.length === 1
          ? ALARM_TEXTS[s.alarms[0].key].slice(0, 40)
          : String(s.alarms.length),
    color:
      s.alarms.length === 0
        ? WIDGET_COLORS.SUCCESS
        : s.alarms.some((alarm) => alarm.severity === 'severe')
          ? WIDGET_COLORS.DANGER
          : WIDGET_COLORS.WARNING,
  });
  return items;
}

function connectionItem(unit) {
  return {
    label: T.connection,
    icon: 'wifi',
    value: unit.reachable === false ? T.unreachable : T.local,
    color: unit.reachable === false ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
  };
}

// Home, away and boost: the fireplace mode stays on the device and in scenes.
export const WIDGET_PROFILES = [PROFILES.HOME, PROFILES.AWAY, PROFILES.BOOST];

function buttons(gladys, unit) {
  const device = unitIds(gladys, unit.uuid).device;
  return WIDGET_PROFILES.map((profile) => ({
    type: 'button',
    label: PROFILE_LABELS[profile],
    icon: PROFILE_ICONS[profile],
    style: unit.snapshot?.profile === profile ? 'primary' : 'secondary',
    action: { key: `set_${profile}`, params: { device } },
  }));
}

function pickUnit(units, settings) {
  try {
    return units.resolve(settings?.device || undefined);
  } catch {
    // Several units and none chosen, or a device that no longer exists: show
    // the first one rather than an empty card.
    return units.identified()[0] ?? null;
  }
}

/**
 * The widget content for the chosen unit (`settings.device`), or the only one.
 */
export function buildContent(gladys, units, { settings, config }) {
  const unit = pickUnit(units, settings);
  if (!unit) {
    return { ttl_seconds: 300, components: [{ type: 'text', text: T.noUnit }] };
  }
  // The title says which unit it is, when there are several.
  const several = units.identified().length > 1;
  const components = several
    ? [{ type: 'text', variant: 'heading', text: units.deviceName(unit).slice(0, 40) }]
    : [];
  if (!unit.snapshot) {
    components.push({ type: 'text', text: T.notRead });
    components.push({ type: 'status', items: [connectionItem(unit)] });
    return { ttl_seconds: 60, components };
  }
  components.push(...tiles(gladys, unit, several ? 3 : 4));
  components.push({
    type: 'status',
    items: [...statusItems(unit, config.filter_warning_days), connectionItem(unit)].slice(0, 10),
  });
  if (unit.reachable !== false) {
    components.push(...buttons(gladys, unit));
  }
  // The computed rows are nudged by src/units.js when they change: the TTL is
  // only a safety net (the time left of a boost moves every minute).
  return { ttl_seconds: 60, components };
}

export const WIDGETS = {
  [VENTILATION_WIDGET]: {
    async get(gladys, units, { settings, config }) {
      logger.debug(`onWidgetGet <- ${VENTILATION_WIDGET}`);
      return buildContent(gladys, units, { settings, config });
    },

    async action(gladys, units, { actionKey, params }) {
      logger.info(`onWidgetAction <- ${VENTILATION_WIDGET}.${actionKey}`);
      const wanted = Object.hasOwn(WIDGET_ACTIONS, actionKey) ? WIDGET_ACTIONS[actionKey] : null;
      if (!wanted) {
        throw new Error(`Unknown widget action: ${actionKey}`);
      }
      const unit = units.resolve(params?.device);
      const profile = await setProfile(units, unit, wanted);
      const label = PROFILE_LABELS[profile] ?? PROFILE_LABELS[wanted];
      return each((l) => `${T.profile[l]}${l === 'fr' ? ' :' : ':'} ${label[l]}`);
    },
  },
};

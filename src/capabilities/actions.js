// -----------------------------------------------------------------------------
// Manifest actions: the buttons of the Configuration screen.
//
// Each key is declared in the manifest `actions` field; index.js registers it
// with `gladys.onAction(key, ...)`. The resolved multi-language message is
// shown under the button; throwing shows the error message instead.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { localize, pick } from '../i18n.js';
import { resetFilterReminder } from './scenes.js';
import { PROFILE_LABELS } from './widget.js';

const logger = createLogger({ name: 'actions' });

function temperature(value) {
  return value === null ? '–' : `${value} °C`;
}

function describeUnit(unit, language) {
  const s = unit.snapshot;
  if (!s || unit.lastError) {
    return pick(language, {
      en: `${unit.host}: no answer (${unit.lastError ?? 'unknown error'}).`,
      fr: `${unit.host} : pas de réponse (${unit.lastError ?? 'erreur inconnue'}).`,
      de: `${unit.host}: keine Antwort (${unit.lastError ?? 'unbekannter Fehler'}).`,
      es: `${unit.host}: sin respuesta (${unit.lastError ?? 'error desconocido'}).`,
    });
  }
  const model = unit.model ?? 'Vallox';
  const firmware = unit.sw_version ? ` ${unit.sw_version}` : '';
  const profile = PROFILE_LABELS[s.profile]?.[language] ?? s.profile;
  const indoor = temperature(s.temperatures.extract);
  const outdoor = temperature(s.temperatures.outdoor);
  return pick(language, {
    en: `${unit.host}: ${model}${firmware}, profile ${profile}, indoor ${indoor}, outdoor ${outdoor}, fan ${s.fan_speed ?? '–'} %.`,
    fr: `${unit.host} : ${model}${firmware}, profil ${profile}, intérieur ${indoor}, extérieur ${outdoor}, ventilation ${s.fan_speed ?? '–'} %.`,
    de: `${unit.host}: ${model}${firmware}, Profil ${profile}, innen ${indoor}, außen ${outdoor}, Lüfter ${s.fan_speed ?? '–'} %.`,
    es: `${unit.host}: ${model}${firmware}, perfil ${profile}, interior ${indoor}, exterior ${outdoor}, ventilación ${s.fan_speed ?? '–'} %.`,
  });
}

export const ACTIONS = {
  // Read every unit now and say what was found.
  async test_connection(units) {
    logger.info('Action test_connection');
    const list = units.list();
    if (list.length === 0) {
      return {
        en: 'No address configured: enter the IP address of your unit, then save.',
        fr: "Aucune adresse configurée : saisissez l'adresse IP de votre centrale, puis enregistrez.",
        de: 'Keine Adresse eingerichtet: Gib die IP-Adresse deines Geräts ein und speichere.',
        es: 'No hay ninguna dirección configurada: introduzca la dirección IP de su unidad y guarde.',
      };
    }
    // A fresh read of each unit: a failed one sets lastError, so the test
    // never reports an old snapshot as an answer.
    await units.refreshAll();
    return localize((language) => list.map((unit) => describeUnit(unit, language)).join('\n'));
  },

  // The filters were just changed: restart the unit's reminder from today.
  async reset_filter_reminder(units, fields) {
    logger.info(`Action reset_filter_reminder <- ${fields.device}`);
    const unit = units.resolve(fields.device);
    const next = await resetFilterReminder(units, unit);
    return localize((language) =>
      pick(language, {
        en: `Filter change recorded today.${next ? ` Next change: ${next}.` : ''}`,
        fr: `Changement de filtre enregistré aujourd'hui.${next ? ` Prochain changement : ${next}.` : ''}`,
        de: `Filterwechsel heute erfasst.${next ? ` Nächster Wechsel: ${next}.` : ''}`,
        es: `Cambio de filtro registrado hoy.${next ? ` Próximo cambio: ${next}.` : ''}`,
      }),
    );
  },
};

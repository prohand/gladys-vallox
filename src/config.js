// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys from the `config_schema` of the manifest;
// the SDK fetches it (`gladys.getConfig()`) and reports every change
// (`gladys.onConfigUpdated()`). This module only provides the defaults and
// normalizes the received object, so the rest of the code never deals with
// `undefined` or with numbers typed as strings.
// -----------------------------------------------------------------------------

// MUST stay consistent with the `default` values of the manifest
// `config_schema` (checked by test/manifest.test.js).
export const DEFAULT_CONFIG = {
  // IP address(es) of the unit(s), separated by commas. No default: the user
  // must say where the unit is.
  hosts: '',
  // Seconds between two reads of the units.
  poll_frequency: 60,
  // Days of filter life left that fire the "filter change due" trigger.
  filter_warning_days: 14,
};

export const POLL_FREQUENCY_BOUNDS = { min: 15, max: 3600 };
export const FILTER_WARNING_BOUNDS = { min: 0, max: 90 };

function clamp(value, { min, max }, fallback) {
  const number = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(number)));
}

/**
 * The list of unit addresses typed by the user: separated by commas, spaces
 * or semicolons, an `http://` or `ws://` prefix and a trailing slash dropped
 * (people paste what their browser shows), duplicates removed.
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parseHosts(raw) {
  if (typeof raw !== 'string') return [];
  const hosts = raw
    .split(/[\s,;]+/)
    .map((entry) =>
      entry
        .trim()
        .replace(/^(?:https?|wss?):\/\//i, '')
        .replace(/\/.*$/, ''),
    )
    .filter((entry) => /^[a-z0-9.\-:[\]]+$/i.test(entry));
  return [...new Set(hosts.map((host) => host.toLowerCase()))];
}

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    hosts: typeof raw.hosts === 'string' ? raw.hosts : DEFAULT_CONFIG.hosts,
    host_list: parseHosts(raw.hosts),
    poll_frequency: clamp(raw.poll_frequency, POLL_FREQUENCY_BOUNDS, DEFAULT_CONFIG.poll_frequency),
    filter_warning_days: clamp(
      raw.filter_warning_days,
      FILTER_WARNING_BOUNDS,
      DEFAULT_CONFIG.filter_warning_days,
    ),
  };
}

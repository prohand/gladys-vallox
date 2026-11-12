// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, FILTER_WARNING_BOUNDS, POLL_FREQUENCY_BOUNDS } from '../src/config.js';
import { SCENE_ACTIONS, SETTABLE_PROFILES, SPEED_PROFILES } from '../src/capabilities/scenes.js';
import { WIDGETS } from '../src/capabilities/widget.js';
import { ACTIONS } from '../src/capabilities/actions.js';
import { TRIGGERS } from '../src/units.js';
import { PROFILES } from '../src/vallox/metrics.js';
import { LANGUAGES } from '../src/i18n.js';

const read = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(await read('gladys-assistant-integration.json'));
const pkg = JSON.parse(await read('package.json'));

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

// Every list of form fields the manifest declares (same field grammar).
const allFields = [
  ...manifest.config_schema,
  ...[...manifest.actions, ...manifest.scene_triggers, ...manifest.scene_actions].flatMap(
    (item) => item.fields ?? [],
  ),
  ...manifest.widgets.flatMap((widget) => widget.settings ?? []),
];

// Every multi-language text of the manifest, with where it is.
function texts(node, path = '') {
  if (Array.isArray(node)) return node.flatMap((item, i) => texts(item, `${path}[${i}]`));
  if (!node || typeof node !== 'object') return [];
  if (typeof node.en === 'string') return [[path, node]];
  return Object.entries(node).flatMap(([key, value]) => texts(value, `${path}.${key}`));
}

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

test('every text of the manifest is written in English, French, German and Spanish', () => {
  const all = texts(manifest);
  assert.ok(all.length > 50);
  for (const [path, text] of all) {
    for (const language of LANGUAGES) {
      assert.equal(typeof text[language], 'string', `${path}.${language} is missing`);
      assert.ok(text[language].trim().length > 0, `${path}.${language} is empty`);
    }
  }
});

test('the user documentation exists in every language', async () => {
  for (const language of LANGUAGES) {
    await access(new URL(`../docs/${language}.md`, import.meta.url));
  }
});

test('the integration is local only, in the climate catalog', () => {
  assert.deepEqual(manifest.transports, ['local']);
  assert.ok(manifest.categories.includes('climate'));
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  // keywords: 5.3.0; scene triggers/actions and widgets: 5.1.0.
  const [major, minor] = minGladysVersion();
  assert.ok(major > 5 || (major === 5 && minor >= 3), manifest.gladys_version);
  assert.ok(manifest.keywords.length >= 1 && manifest.keywords.length <= 10);
  const normalized = manifest.keywords.map((k) => k.trim().toLowerCase());
  assert.equal(new Set(normalized).size, normalized.length, 'keywords must be unique');
  for (const keyword of manifest.keywords) {
    assert.ok(keyword.length >= 2 && keyword.length <= 30, keyword);
  }
});

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), Object.keys(ACTIONS).sort());
});

test('every scene action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
});

test('every scene trigger the code fires is declared, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
});

test('every scene trigger declares the device filter and the device name variable', () => {
  for (const trigger of manifest.scene_triggers) {
    const device = trigger.fields.find((field) => field.key === 'device');
    assert.equal(device?.source, 'devices', `${trigger.key}: device filter`);
    assert.ok(keysOf(trigger.variables).includes('device_name'), `${trigger.key}: device_name`);
  }
});

test('the profile options are the profiles the code knows', () => {
  const options = (list, key) =>
    list
      .find((field) => field.key === key)
      .options.map((option) => option.value)
      .sort();
  const byKey = (list, key) => list.find((item) => item.key === key);
  assert.deepEqual(
    options(byKey(manifest.scene_triggers, 'profile_changed').fields, 'profile'),
    Object.values(PROFILES).sort(),
  );
  assert.deepEqual(
    options(byKey(manifest.scene_actions, 'set_profile').fields, 'profile'),
    [...SETTABLE_PROFILES].sort(),
  );
  assert.deepEqual(
    options(byKey(manifest.scene_actions, 'set_fan_speed').fields, 'profile'),
    [...SPEED_PROFILES].sort(),
  );
});

test('every widget has a content handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets).sort(), Object.keys(WIDGETS).sort());
});

test('config_schema defaults and bounds stay consistent with the code', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') continue;
    assert.ok(field.key in DEFAULT_CONFIG, `${field.key} has no default in DEFAULT_CONFIG`);
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, field.key);
    }
  }
  const field = (key) => manifest.config_schema.find((f) => f.key === key);
  assert.equal(field('poll_frequency').min, POLL_FREQUENCY_BOUNDS.min);
  assert.equal(field('poll_frequency').max, POLL_FREQUENCY_BOUNDS.max);
  assert.equal(field('filter_warning_days').min, FILTER_WARNING_BOUNDS.min);
  assert.equal(field('filter_warning_days').max, FILTER_WARNING_BOUNDS.max);
});

// The types the store schema accepts: anything else rejects the manifest.
const FIELD_TYPES = [
  'string',
  'number',
  'boolean',
  'select',
  'multi_select',
  'secret',
  'oauth2',
  'section',
];

test('every field uses a type, a key and options the store accepts', () => {
  for (const field of allFields) {
    assert.ok(FIELD_TYPES.includes(field.type), `${field.key}: unknown type ${field.type}`);
    assert.match(field.key, /^[a-z0-9_]+$/, `field key "${field.key}" must be snake_case`);
    if (field.type === 'section') {
      assert.equal(field.required, undefined, `section ${field.key}`);
      assert.equal(field.default, undefined, `section ${field.key}`);
      assert.equal(field.placeholder, undefined, `section ${field.key}`);
      assert.ok(!(field.key in DEFAULT_CONFIG), `section ${field.key} stores no value`);
      for (const link of field.links ?? []) {
        assert.match(link.url, /^https:\/\//, 'section links must be https');
      }
    }
    if (field.placeholder !== undefined) {
      assert.ok(['string', 'number', 'secret'].includes(field.type), field.key);
    }
    if (field.min !== undefined || field.max !== undefined) {
      assert.equal(field.type, 'number', `${field.key}: min/max are number-only`);
    }
    if (field.source !== undefined) {
      assert.equal(field.source, 'devices', field.key);
      assert.equal(field.options, undefined, `${field.key}: source and options together`);
    }
  }
});

test('the timeouts leave room for the retries of a slow unit', () => {
  for (const item of [...manifest.actions, ...manifest.scene_actions]) {
    assert.ok(item.timeout_seconds >= 30 && item.timeout_seconds <= 120, item.key);
  }
  for (const widget of manifest.widgets) {
    assert.ok(widget.action_timeout_seconds >= 30, widget.key);
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.equal(manifest.docker_image, `ghcr.io/prohand/gladys-vallox:${manifest.version}`);
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [language, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${language} has ${text.length} characters (10 to 100 allowed)`,
    );
  }
});

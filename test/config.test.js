import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseHosts } from '../src/config.js';

test('the defaults apply to an empty config', () => {
  const config = normalizeConfig();
  assert.equal(config.poll_frequency, DEFAULT_CONFIG.poll_frequency);
  assert.equal(config.filter_warning_days, DEFAULT_CONFIG.filter_warning_days);
  assert.deepEqual(config.host_list, []);
});

test('addresses are split, cleaned and deduplicated', () => {
  assert.deepEqual(parseHosts('192.168.1.50'), ['192.168.1.50']);
  assert.deepEqual(parseHosts(' 192.168.1.50 , http://192.168.1.51/ ; vallox.lan\n'), [
    '192.168.1.50',
    '192.168.1.51',
    'vallox.lan',
  ]);
  assert.deepEqual(parseHosts('ws://Vallox.LAN, vallox.lan'), ['vallox.lan']);
  assert.deepEqual(parseHosts('192.168.1.50:8080'), ['192.168.1.50:8080']);
  assert.deepEqual(parseHosts('not a host!, '), ['not', 'a']);
  assert.deepEqual(parseHosts(undefined), []);
  assert.deepEqual(parseHosts(42), []);
});

test('numbers typed as strings are converted and kept in bounds', () => {
  const config = normalizeConfig({ poll_frequency: '5', filter_warning_days: '200' });
  assert.equal(config.poll_frequency, 15);
  assert.equal(config.filter_warning_days, 90);
  assert.equal(normalizeConfig({ poll_frequency: '' }).poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: 'abc' }).poll_frequency, 60);
  assert.equal(normalizeConfig({ filter_warning_days: 0 }).filter_warning_days, 0);
});

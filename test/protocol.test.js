import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReadTablesRequest,
  buildWriteRequest,
  checksum,
  parseTable,
  toCelsius,
  toKelvin,
} from '../src/vallox/protocol.js';

// Reference frames, as captured from units (and used by the Python library
// Home Assistant relies on).
test('the READ_TABLES request is the reference frame', () => {
  assert.equal(buildReadTablesRequest().toString('hex'), '0300f6000000f900');
});

test('a temperature write is the reference frame', () => {
  const frame = buildWriteRequest([{ address: 20514, value: toKelvin(19) }]);
  assert.equal(frame.toString('hex'), '0400f90022501f723ec3');
});

test('a temperature is rounded to the tenth before it is written', () => {
  assert.equal(
    buildWriteRequest([{ address: 20514, value: toKelvin(19.145) }]).toString('hex'),
    '0400f9002250297248c3',
  );
  assert.equal(
    buildWriteRequest([{ address: 20514, value: toKelvin(18.991) }]).toString('hex'),
    '0400f90022501f723ec3',
  );
});

test('a multi-register write is sorted by address', () => {
  const frame = buildWriteRequest([
    { address: 4614, value: 0 },
    { address: 4609, value: 0 },
    { address: 4612, value: 0 },
    { address: 4613, value: 0 },
  ]);
  assert.equal(frame.toString('hex'), '0a00f900011200000412000005120000061200001349');
});

test('a write refuses nothing to write and out of range values', () => {
  assert.throws(() => buildWriteRequest([]), /Nothing to write/);
  assert.throws(() => buildWriteRequest([{ address: 4609, value: -1 }]), /Invalid value/);
  assert.throws(() => buildWriteRequest([{ address: 4609, value: 1.5 }]), /Invalid value/);
  assert.throws(() => buildWriteRequest([{ address: 70000, value: 1 }]), /Invalid register/);
});

test('the checksum is a 16-bit sum', () => {
  assert.equal(checksum([3, 246, 0]), 249);
  assert.equal(checksum([0xffff, 2]), 1);
});

test('a table is read as big-endian words, an odd trailing byte ignored', () => {
  assert.deepEqual(parseTable(Buffer.from('0024000100ffab', 'hex')), [0x24, 1, 0xff]);
  assert.deepEqual(parseTable(new Uint8Array([0, 5]).buffer), [5]);
});

test('temperatures convert between hundredths of kelvin and °C', () => {
  assert.equal(toCelsius(29315), 20);
  assert.equal(toCelsius(29361), 20.5);
  assert.equal(toCelsius(27045), -2.7);
  assert.equal(toCelsius(0), null);
  assert.equal(toCelsius(0xffff), null);
  assert.equal(toCelsius(null), null);
  assert.equal(toKelvin(20), 29315);
  assert.equal(toKelvin(-2.7), 27045);
  assert.equal(toCelsius(toKelvin(21.7)), 21.7);
});

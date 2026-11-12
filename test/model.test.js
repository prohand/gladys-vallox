import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundle } from './helpers/bundle.js';
import {
  BUILT_IN_ADDRESSES,
  builtInModel,
  faultRegister,
  modelFromScript,
  parseConstants,
} from '../src/vallox/model.js';

test('constants are read with numbers, hex, exponents and references', () => {
  const { dev, read } = parseConstants(
    [
      'VlxDevConstants.A=12,',
      'VlxDevConstants.B = 0x1F;',
      'VlxDevConstants.C=46e3,',
      'VlxDevConstants.D=VlxDevConstants.A,',
      'VlxDevConstants.A=99,',
      'VlxReadConstants.N=7;',
      'VlxDevConstants.E=VlxDevConstants.UNKNOWN,',
    ].join('\n'),
  );
  assert.deepEqual(dev, { A: 12, B: 31, C: 46000, D: 12 });
  assert.deepEqual(read, { N: 7 });
});

test('the model of a firmware 2 unit places the registers like the built-in one', () => {
  const model = modelFromScript(bundle());
  const builtIn = builtInModel();
  assert.equal(model.source, 'unit');
  for (const [name, address] of Object.entries(BUILT_IN_ADDRESSES)) {
    assert.equal(model.addressOf(name), address, name);
    assert.equal(model.offsetOf(address), builtIn.offsetOf(address), name);
  }
  // general_info starts the table, the extended range comes last.
  assert.equal(model.offsetOf(0), 0);
  assert.equal(model.offsetOf(46000), 666);
  assert.equal(model.tableSize, 690);
});

test('a firmware 3 unit (constant flow range) is read the same way', () => {
  const model = modelFromScript(bundle({ firmware: 3 }));
  // 281 words of the ranges before, 16 of constant flow, then the fault count.
  assert.equal(model.offsetOf(BUILT_IN_ADDRESSES.A_CYC_TOTAL_FAULT_COUNT), 281 + 16 + 1);
});

test("the unit's own addresses win over the built-in ones", () => {
  const model = modelFromScript(bundle({ extraAddresses: { A_CYC_NEW_REGISTER: 4370 } }));
  assert.equal(model.addressOf('A_CYC_NEW_REGISTER'), 4370);
});

test('a script without the table layout gives no model', () => {
  assert.equal(modelFromScript('VlxDevConstants.A_CYC_STATE=4609;'), null);
  assert.equal(modelFromScript(''), null);
  const withoutFaults = bundle().replace(/VlxReadConstants\.CYC_NUM_OF_FAULTS=200,/, '');
  assert.equal(modelFromScript(withoutFaults), null);
});

test('reading a table picks each register at its offset', () => {
  const model = builtInModel();
  const table = new Array(model.tableSize).fill(0);
  table[model.offsetOf(4353)] = 55;
  table[model.offsetOf(4609)] = 1;
  assert.deepEqual(model.read(table, ['A_CYC_FAN_SPEED', 'A_CYC_STATE', 'A_CYC_UNKNOWN']), {
    A_CYC_FAN_SPEED: 55,
    A_CYC_STATE: 1,
  });
  // A short answer leaves the registers it does not carry out.
  assert.deepEqual(model.read([1, 2], ['A_CYC_FAN_SPEED']), {});
});

test('the fault log registers follow the 6-register slots', () => {
  assert.equal(BUILT_IN_ADDRESSES[faultRegister('CODE', 1)], 36866);
  assert.equal(BUILT_IN_ADDRESSES[faultRegister('ACTIVITY', 1)], 36871);
  assert.equal(BUILT_IN_ADDRESSES[faultRegister('CODE', 2)], 36872);
  assert.equal(faultRegister('SEVERITY', 4), 'A_CYC_FAULT_SEVERITY_4');
  assert.equal(BUILT_IN_ADDRESSES.A_CYC_FAULT_COUNT_4, 36888);
});

// -----------------------------------------------------------------------------
// An in-memory Vallox unit, for the tests: no network, no hardware.
//
// It answers the two frames the integration sends, the way a unit does:
//   - READ_TABLES: the register table, big-endian words, laid out by the
//     built-in data model (the layout every known firmware shares);
//   - WRITE_DATA: applies the (address, value) pairs to its registers.
// `request` has the signature of `webSocketRequest` (src/vallox/client.js) and
// is injected in place of it.
// -----------------------------------------------------------------------------

import { builtInModel } from '../../src/vallox/model.js';
import { COMMANDS, checksum, toKelvin } from '../../src/vallox/protocol.js';

const swap16 = (word) => ((word & 0xff) << 8) | ((word >> 8) & 0xff);

// A ValloPlus 350 MV, firmware 2.0.16, at home, everything in order.
export function defaultRegisters() {
  const version = [0, 0, 0, 0, 0, 0, 2, 0, 16];
  return {
    ...Object.fromEntries(version.map((v, i) => [`A_CYC_APPL_SW_VERSION_${i + 1}`, swap16(v)])),
    A_CYC_MACHINE_MODEL: 6,
    A_CYC_UUID0: 0x8607,
    A_CYC_UUID1: 0x6097,
    A_CYC_UUID2: 0xf788,
    A_CYC_UUID3: 0x44b7,
    A_CYC_UUID4: 0xac4d,
    A_CYC_UUID5: 0xb61e,
    A_CYC_UUID6: 0x502f,
    A_CYC_UUID7: 0xe4f2,
    A_CYC_FAN_SPEED: 40,
    A_CYC_TEMP_EXTRACT_AIR: toKelvin(21.7),
    A_CYC_TEMP_EXHAUST_AIR: toKelvin(5),
    A_CYC_TEMP_OUTDOOR_AIR: toKelvin(-2.7),
    A_CYC_TEMP_SUPPLY_CELL_AIR: toKelvin(18.2),
    A_CYC_TEMP_SUPPLY_AIR: toKelvin(19.5),
    A_CYC_EXTR_FAN_SPEED: 1500,
    A_CYC_SUPP_FAN_SPEED: 1450,
    A_CYC_RH_VALUE: 45,
    A_CYC_CO2_VALUE: 640,
    A_CYC_STATE: 0,
    A_CYC_MODE: 0,
    A_CYC_BOOST_TIMER: 0,
    A_CYC_FIREPLACE_TIMER: 0,
    A_CYC_EXTRA_TIMER: 0,
    A_CYC_CELL_STATE: 0,
    A_CYC_REMAINING_TIME_FOR_FILTER: 120,
    A_CYC_ENABLED: 1,
    A_CYC_HOME_SPEED_SETTING: 40,
    A_CYC_AWAY_SPEED_SETTING: 20,
    A_CYC_BOOST_SPEED_SETTING: 90,
    A_CYC_HOME_AIR_TEMP_TARGET: toKelvin(20),
    A_CYC_AWAY_AIR_TEMP_TARGET: toKelvin(18),
    A_CYC_BOOST_AIR_TEMP_TARGET: toKelvin(17),
    A_CYC_BOOST_TIME: 30,
    A_CYC_FIREPLACE_TIME: 15,
    A_CYC_EXTRA_TIME: 10,
    A_CYC_FILTER_CHANGE_INTERVAL: 180,
    A_CYC_FILTER_CHANGED_DAY: 8,
    A_CYC_FILTER_CHANGED_MONTH: 1,
    A_CYC_FILTER_CHANGED_YEAR: 26,
    A_CYC_TOTAL_FAULT_COUNT: 0,
  };
}

/**
 * @param {Record<string, number>} [overrides] raw register values
 */
export function createFakeUnit(overrides = {}) {
  const model = builtInModel();
  const byAddress = new Map(Object.entries(model.addresses).map(([name, a]) => [a, name]));
  const unit = {
    registers: { ...defaultRegisters(), ...overrides },
    online: true,
    writes: [],
    reads: 0,
    frames: [],

    set(values) {
      Object.assign(unit.registers, values);
    },

    table() {
      const words = new Array(model.tableSize + 20).fill(0);
      for (const [name, value] of Object.entries(unit.registers)) {
        const offset = model.offsetOf(model.addresses[name]);
        if (offset !== null) words[offset] = value;
      }
      const buffer = Buffer.alloc(words.length * 2);
      words.forEach((word, i) => buffer.writeUInt16BE(word, i * 2));
      return buffer;
    },

    async request(_host, frame) {
      unit.frames.push(Buffer.from(frame));
      if (!unit.online) {
        throw new Error('connect ECONNREFUSED');
      }
      const words = [];
      for (let i = 0; i + 1 < frame.length; i += 2) words.push(frame.readUInt16LE(i));
      if (checksum(words.slice(0, -1)) !== words.at(-1)) {
        throw new Error('bad checksum');
      }
      if (words[1] === COMMANDS.READ_TABLES) {
        unit.reads += 1;
        return unit.table();
      }
      if (words[1] === COMMANDS.WRITE_DATA) {
        const written = {};
        for (let i = 2; i < words.length - 1; i += 2) {
          written[byAddress.get(words[i]) ?? words[i]] = words[i + 1];
        }
        unit.writes.push(written);
        Object.assign(unit.registers, written);
        return Buffer.from(frame);
      }
      throw new Error(`unknown command ${words[1]}`);
    },
  };
  return unit;
}

/** The UUID of the default fake unit, as the snapshot spells it. */
export const FAKE_UUID = '86076097-f788-44b7-ac4d-b61e502fe4f2';

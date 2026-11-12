// -----------------------------------------------------------------------------
// The data model of a Vallox unit: which register lives where.
//
// Every register has an address ("A_CYC_FAN_SPEED" = 4353), and the
// READ_TABLES answer packs several address RANGES one after the other: the
// position of a register in that answer is its offset in its range plus the
// sizes of the ranges before it. The unit describes all of it in the
// JavaScript of its own web interface (`/js/bundle.js`, or `/js/vallox.js` on
// older firmwares), as lines such as:
//
//   VlxDevConstants.A_CYC_FAN_SPEED=4353,
//   VlxDevConstants.RANGE_START_g_cyclone_extended=46e3,
//   VlxReadConstants.CYC_NUM_OF_HW_STATES=43,
//
// So the model is read from the unit itself first. When that fails (an
// unknown firmware layout, the page did not answer), the built-in model below
// takes over: the registers this integration reads have kept the same
// addresses and the same positions on every firmware seen so far (2.0.x and
// 3.x), because the ranges that differ come after them.
// -----------------------------------------------------------------------------

// The ranges of the table, in the order the answer packs them, each with the
// read constant that gives its size. The firmware 2 `g_self_test` range is
// `g_constant_flow` on firmware 3, same place, same size.
const RANGE_LAYOUT = [
  ['g_cyclone_general_info', 'CYC_NUM_OF_GENERAL_INFO'],
  ['g_typhoon_general_info', 'CYC_NUM_OF_GENERAL_TYP_INFO'],
  ['g_cyclone_hw_state', 'CYC_NUM_OF_HW_STATES'],
  ['g_cyclone_sw_state', 'CYC_NUM_OF_SW_STATES'],
  ['g_cyclone_time', 'CYC_NUM_OF_TIME_ELEMENTS'],
  ['g_cyclone_output', 'CYC_NUM_OF_OUTPUTS'],
  ['g_cyclone_input', 'CYC_NUM_OF_INPUTS'],
  ['g_cyclone_config', 'CYC_NUM_OF_CONFIGS'],
  ['g_cyclone_settings', 'CYC_NUM_OF_CYC_SETTINGS'],
  ['g_typhoon_settings', 'CYC_NUM_OF_TYP_SETTINGS'],
  ['g_self_test|g_constant_flow', 'CYC_NUM_OF_SELF_TESTS|CYC_NUM_OF_CF'],
  ['g_faults', 'CYC_NUM_OF_FAULTS'],
  ['g_cyclone_weekly_schedule', 'CYC_NUM_OF_SCHEDULED_EVENTS'],
  ['g_cyclone_extended', 'CYC_NUM_OF_EXT_SETTINGS', { optional: true }],
];

// Built-in model: the ranges of firmware 2.0.x / 3.x up to the faults (the
// registers read here all live there), as [start, end, size].
const BUILT_IN_RANGES = [
  [0, 35, 36],
  [256, 282, 27],
  [4352, 4394, 43],
  [4608, 4632, 25],
  [4848, 4854, 7],
  [4864, 4870, 7],
  [5120, 5126, 7],
  [8192, 8221, 30],
  [20480, 20555, 76],
  [21760, 21782, 23],
  [32768, 32783, 16],
  [36864, 37063, 200],
];

// The registers this integration uses, with their address on every known
// firmware. The unit's own model wins when it was read.
export const BUILT_IN_ADDRESSES = {
  A_CYC_APPL_SW_VERSION_1: 2,
  A_CYC_APPL_SW_VERSION_2: 3,
  A_CYC_APPL_SW_VERSION_3: 4,
  A_CYC_APPL_SW_VERSION_4: 5,
  A_CYC_APPL_SW_VERSION_5: 6,
  A_CYC_APPL_SW_VERSION_6: 7,
  A_CYC_APPL_SW_VERSION_7: 8,
  A_CYC_APPL_SW_VERSION_8: 9,
  A_CYC_APPL_SW_VERSION_9: 10,
  A_CYC_SERIAL_NUMBER_MSW: 14,
  A_CYC_SERIAL_NUMBER_LSW: 15,
  A_CYC_MACHINE_MODEL: 17,
  A_CYC_FAN_SPEED: 4353,
  A_CYC_TEMP_EXTRACT_AIR: 4354,
  A_CYC_TEMP_EXHAUST_AIR: 4355,
  A_CYC_TEMP_OUTDOOR_AIR: 4356,
  A_CYC_TEMP_SUPPLY_CELL_AIR: 4357,
  A_CYC_TEMP_SUPPLY_AIR: 4358,
  A_CYC_EXTR_FAN_SPEED: 4361,
  A_CYC_SUPP_FAN_SPEED: 4362,
  A_CYC_RH_VALUE: 4363,
  A_CYC_CO2_VALUE: 4364,
  A_CYC_STATE: 4609,
  A_CYC_MODE: 4610,
  A_CYC_BOOST_TIMER: 4612,
  A_CYC_FIREPLACE_TIMER: 4613,
  A_CYC_EXTRA_TIMER: 4614,
  A_CYC_CELL_STATE: 4616,
  A_CYC_REMAINING_TIME_FOR_FILTER: 4620,
  A_CYC_ENABLED: 4626,
  A_CYC_UUID0: 8214,
  A_CYC_UUID1: 8215,
  A_CYC_UUID2: 8216,
  A_CYC_UUID3: 8217,
  A_CYC_UUID4: 8218,
  A_CYC_UUID5: 8219,
  A_CYC_UUID6: 8220,
  A_CYC_UUID7: 8221,
  A_CYC_AWAY_SPEED_SETTING: 20501,
  A_CYC_AWAY_AIR_TEMP_TARGET: 20502,
  A_CYC_HOME_SPEED_SETTING: 20507,
  A_CYC_HOME_AIR_TEMP_TARGET: 20508,
  A_CYC_BOOST_SPEED_SETTING: 20513,
  A_CYC_BOOST_AIR_TEMP_TARGET: 20514,
  A_CYC_EXTRA_TIME: 20496,
  A_CYC_FILTER_CHANGE_INTERVAL: 20537,
  A_CYC_BOOST_TIME: 20544,
  A_CYC_FIREPLACE_TIME: 20545,
  A_CYC_FILTER_CHANGED_DAY: 20546,
  A_CYC_FILTER_CHANGED_MONTH: 20547,
  A_CYC_FILTER_CHANGED_YEAR: 20548,
  A_CYC_TOTAL_FAULT_COUNT: 36865,
};

// The fault log: 33 slots of 6 registers from A_CYC_FAULT_CODE (36866).
// Firmwares name them A_CYC_FAULT_<FIELD> for the first slot and
// A_CYC_FAULT_<FIELD>_<n> for the next ones.
export const FAULT_SLOTS = 33;
const FAULT_BASE = 36866;
const FAULT_FIELDS = ['CODE', 'SEVERITY', 'FIRST_DATE', 'LAST_DATE', 'COUNT', 'ACTIVITY'];

/** Register name of a fault field, slot counted from 1. */
export function faultRegister(field, slot) {
  return slot === 1 ? `A_CYC_FAULT_${field}` : `A_CYC_FAULT_${field}_${slot}`;
}

for (let slot = 1; slot <= FAULT_SLOTS; slot += 1) {
  FAULT_FIELDS.forEach((field, index) => {
    BUILT_IN_ADDRESSES[faultRegister(field, slot)] = FAULT_BASE + (slot - 1) * 6 + index;
  });
}

/**
 * A data model: register addresses, and their position in the table.
 */
export class DataModel {
  /**
   * @param {Record<string, number>} addresses register name -> address
   * @param {Array<[number, number, number]>} ranges [start, end, size], in table order
   * @param {string} source where it comes from ('unit' | 'built-in'), for the logs
   */
  constructor(addresses, ranges, source) {
    this.addresses = addresses;
    this.source = source;
    let position = 0;
    this.ranges = ranges.map(([start, end, size]) => {
      const range = { start, end, position };
      position += size;
      return range;
    });
    this.tableSize = position;
  }

  /** Position of an address in the READ_TABLES answer, or null. */
  offsetOf(address) {
    const range = this.ranges.find((r) => address >= r.start && address <= r.end);
    return range ? range.position + (address - range.start) : null;
  }

  /** Address of a register, or undefined when this firmware has none. */
  addressOf(name) {
    return this.addresses[name];
  }

  /**
   * The value of named registers in a parsed table (raw words). A register
   * the model or the answer does not carry reads as undefined.
   * @param {number[]} table
   * @param {string[]} names
   */
  read(table, names) {
    const values = {};
    for (const name of names) {
      const address = this.addresses[name];
      if (address === undefined) continue;
      const offset = this.offsetOf(address);
      if (offset === null || offset >= table.length) continue;
      values[name] = table[offset];
    }
    return values;
  }
}

/** The model used when the unit's own one cannot be read. */
export function builtInModel() {
  return new DataModel({ ...BUILT_IN_ADDRESSES }, BUILT_IN_RANGES, 'built-in');
}

const CONSTANT_LINE = /\b(Vlx(?:Dev|Read)Constants)\.(\w+)\s*=\s*([\w.]+)\s*[,;]/g;

function parseNumber(text) {
  if (/^0x[0-9a-f]+$/i.test(text)) return parseInt(text, 16);
  if (/^\d+(?:\.\d+)?(?:e\d+)?$/i.test(text)) return Math.trunc(Number(text));
  return undefined;
}

/**
 * Read the constants out of the web interface script of a unit.
 * @param {string} source content of js/bundle.js or js/vallox.js
 * @returns {{ dev: Record<string, number>, read: Record<string, number> }}
 */
export function parseConstants(source) {
  const constants = { VlxDevConstants: {}, VlxReadConstants: {} };
  for (const [, group, key, rawValue] of source.matchAll(CONSTANT_LINE)) {
    let value = parseNumber(rawValue);
    if (value === undefined) {
      // A reference to a constant defined earlier: `VlxDevConstants.X`.
      const [refGroup, refKey] = rawValue.split('.');
      value = constants[refGroup]?.[refKey];
    }
    // The first definition wins: later lines are code reading the constants.
    if (value !== undefined && !(key in constants[group])) {
      constants[group][key] = value;
    }
  }
  return { dev: constants.VlxDevConstants, read: constants.VlxReadConstants };
}

/**
 * Build a model from the constants of a unit, or null when they do not
 * describe a table this integration can read.
 * @param {string} source content of js/bundle.js or js/vallox.js
 */
export function modelFromScript(source) {
  const { dev, read } = parseConstants(source);
  const ranges = [];
  for (const [names, sizes, options] of RANGE_LAYOUT) {
    const name = names.split('|').find((n) => dev[`RANGE_START_${n}`] !== undefined);
    const sizeKey = sizes.split('|').find((s) => read[s] !== undefined);
    const start = dev[`RANGE_START_${name}`];
    const end = dev[`RANGE_END_${name}`];
    const size = read[sizeKey];
    if (name === undefined || end === undefined || size === undefined) {
      if (options?.optional) continue;
      return null;
    }
    ranges.push([start, end, size]);
  }
  const addresses = Object.fromEntries(
    Object.entries(dev).filter(([key]) => key.startsWith('A_CYC_')),
  );
  // Every register read here must be found, or the built-in model is safer.
  for (const name of ['A_CYC_FAN_SPEED', 'A_CYC_STATE', 'A_CYC_UUID0', 'A_CYC_TEMP_SUPPLY_AIR']) {
    if (addresses[name] === undefined) return null;
  }
  return new DataModel({ ...BUILT_IN_ADDRESSES, ...addresses }, ranges, 'unit');
}

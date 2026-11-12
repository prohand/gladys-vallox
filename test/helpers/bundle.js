// A unit's js/bundle.js, for the tests (see src/vallox/model.js).
import { BUILT_IN_ADDRESSES } from '../../src/vallox/model.js';

// The shape of a unit's js/bundle.js: minified assignments, numbers written
// as `46e3`, hexadecimal, references to earlier constants, and later code
// that reads the constants back (never taken as a definition).
const RANGES = [
  ['g_cyclone_general_info', 0, 35, 'CYC_NUM_OF_GENERAL_INFO', 36],
  ['g_typhoon_general_info', 256, 282, 'CYC_NUM_OF_GENERAL_TYP_INFO', 27],
  ['g_cyclone_hw_state', 4352, 4394, 'CYC_NUM_OF_HW_STATES', 43],
  ['g_cyclone_sw_state', 4608, 4632, 'CYC_NUM_OF_SW_STATES', 25],
  ['g_cyclone_time', 4848, 4854, 'CYC_NUM_OF_TIME_ELEMENTS', 7],
  ['g_cyclone_output', 4864, 4870, 'CYC_NUM_OF_OUTPUTS', 7],
  ['g_cyclone_input', 5120, 5126, 'CYC_NUM_OF_INPUTS', 7],
  ['g_cyclone_config', 8192, 8221, 'CYC_NUM_OF_CONFIGS', 30],
  ['g_cyclone_settings', 20480, 20555, 'CYC_NUM_OF_CYC_SETTINGS', 76],
  ['g_typhoon_settings', 21760, 21782, 'CYC_NUM_OF_TYP_SETTINGS', 23],
];

export function bundle({ firmware = 2, extraAddresses = {} } = {}) {
  const lines = ['!function(){var e;'];
  const ranges = [
    ...RANGES,
    firmware === 2
      ? ['g_self_test', 32768, 32783, 'CYC_NUM_OF_SELF_TESTS', 16]
      : ['g_constant_flow', 32768, 32783, 'CYC_NUM_OF_CF', 16],
    ['g_faults', 36864, 37063, 'CYC_NUM_OF_FAULTS', 200],
    ['g_cyclone_weekly_schedule', 40960, 41128, 'CYC_NUM_OF_SCHEDULED_EVENTS', 169],
  ];
  for (const [name, start, end, count, size] of ranges) {
    lines.push(`VlxDevConstants.RANGE_START_${name}=${start},`);
    lines.push(`VlxDevConstants.RANGE_END_${name}=${end},`);
    lines.push(`VlxReadConstants.${count}=${size},`);
  }
  lines.push('VlxDevConstants.RANGE_START_g_cyclone_extended=46e3,');
  lines.push('VlxDevConstants.RANGE_END_g_cyclone_extended=0xB3B7,');
  lines.push('VlxReadConstants.CYC_NUM_OF_EXT_SETTINGS=24,');
  for (const [name, address] of Object.entries({ ...BUILT_IN_ADDRESSES, ...extraAddresses })) {
    lines.push(`VlxDevConstants.${name}=${address},`);
  }
  lines.push('VlxDevConstants.WS_WEB_UI_COMMAND_WRITE_DATA=249;');
  // Code reading the constants: never a definition.
  lines.push('e>=VlxDevConstants.RANGE_START_g_faults&&(t=VlxDevConstants.A_CYC_STATE);}();');
  return lines.join('\n');
}

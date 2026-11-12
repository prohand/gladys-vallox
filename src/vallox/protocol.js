// -----------------------------------------------------------------------------
// The binary frames of the Vallox WebSocket API.
//
// A Vallox MV unit (and the Helios KWL units built on the same controller)
// serves its web interface on port 80 and talks to it over a WebSocket on
// `ws://<unit>/`. The frames are arrays of 16-bit words:
//
//   request   [length, command, ...payload, checksum]   little-endian words
//   response  [word, word, word, ...]                    BIG-endian words
//
// - `length` counts the words after itself (command + payload + checksum);
// - `checksum` is the 16-bit sum of every word before it, length included;
// - READ_TABLES (246) takes one zero word and answers with the whole register
//   table in one frame (a few hundred words);
// - WRITE_DATA (249) takes (address, value) pairs, sorted by address.
//
// The register addresses ("A_CYC_*") and the way they are laid out in the
// table come from the data model, see model.js.
//
// The wire format was documented by the `vallox_websocket_api` Python library
// (yozik04, LGPL-3.0), the one Home Assistant uses; this is an independent
// JavaScript implementation, checked against the same reference frames.
// -----------------------------------------------------------------------------

export const COMMANDS = {
  WRITE_DATA: 249,
  READ_TABLES: 246,
};

// 0xFFFF in a register means "no value" (an empty sensor slot, a counter never
// set) — except in the profile timers, where it means "no time limit".
export const NO_VALUE = 0xffff;

// Temperatures are stored in hundredths of a kelvin.
const KELVIN_OFFSET = 27315;

/**
 * 16-bit sum of the words of a frame.
 * @param {number[]} words
 */
export function checksum(words) {
  return words.reduce((sum, word) => (sum + word) & 0xffff, 0);
}

function toFrame(words) {
  const all = [...words, checksum(words)];
  const buffer = Buffer.alloc(all.length * 2);
  all.forEach((word, index) => buffer.writeUInt16LE(word & 0xffff, index * 2));
  return buffer;
}

/** The READ_TABLES request: `0300 f600 0000 f900`. */
export function buildReadTablesRequest() {
  return toFrame([3, COMMANDS.READ_TABLES, 0]);
}

/**
 * The WRITE_DATA request for a set of registers.
 * @param {Array<{ address: number, value: number }>} items raw register values
 */
export function buildWriteRequest(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Nothing to write');
  }
  const sorted = [...items].sort((a, b) => a.address - b.address);
  const words = [sorted.length * 2 + 2, COMMANDS.WRITE_DATA];
  for (const { address, value } of sorted) {
    if (!Number.isInteger(address) || address < 0 || address > 0xffff) {
      throw new Error(`Invalid register address ${address}`);
    }
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      throw new Error(`Invalid value ${value} for register ${address}`);
    }
    words.push(address, value);
  }
  return toFrame(words);
}

/**
 * The words of a READ_TABLES answer.
 * @param {Buffer|ArrayBuffer|Uint8Array} data
 * @returns {number[]}
 */
export function parseTable(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const words = [];
  for (let offset = 0; offset + 1 < buffer.length; offset += 2) {
    words.push(buffer.readUInt16BE(offset));
  }
  return words;
}

/**
 * A raw temperature register in °C, one decimal. 0 is an absent sensor.
 * @param {number|null} raw
 */
export function toCelsius(raw) {
  if (raw === null || raw === undefined || raw === 0 || raw === NO_VALUE) {
    return null;
  }
  return Math.round((raw - KELVIN_OFFSET) / 10) / 10;
}

/**
 * A temperature in °C as the unit stores it. Rounded to the tenth first, the
 * way the unit's own interface does: 19.145 is written as 19.1 °C.
 * @param {number} celsius
 */
export function toKelvin(celsius) {
  return Math.round(Number(celsius) * 10) * 10 + KELVIN_OFFSET;
}

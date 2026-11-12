// -----------------------------------------------------------------------------
// The client of ONE Vallox unit, on the local network.
//
// One short WebSocket connection per request, the way the unit's own web
// interface and the Home Assistant library do it: open `ws://<host>/`, send
// one frame, read one answer, close. The unit serves very few connections at
// a time, so the requests of a unit are queued (one at a time), and a request
// that fails on the network is tried again a few times before giving up.
//
// Node's built-in WebSocket client (Node 22+) is enough: no dependency.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { buildReadTablesRequest, buildWriteRequest, parseTable, toKelvin } from './protocol.js';
import { builtInModel, modelFromScript } from './model.js';
import { REGISTERS, toSnapshot } from './metrics.js';

const logger = createLogger({ name: 'vallox' });

const REQUEST_TIMEOUT_MS = 5_000;
const MODEL_TIMEOUT_MS = 10_000;
const RETRY_DELAYS_MS = [200, 500, 1_000];
const MODEL_PATHS = ['js/bundle.js', 'js/vallox.js'];

// The registers a write may touch. Anything else is refused before it reaches
// the unit: a wrong address can change an installer setting.
const WRITABLE = new Set([
  'A_CYC_MODE',
  'A_CYC_STATE',
  'A_CYC_BOOST_TIMER',
  'A_CYC_FIREPLACE_TIMER',
  'A_CYC_EXTRA_TIMER',
  'A_CYC_HOME_SPEED_SETTING',
  'A_CYC_AWAY_SPEED_SETTING',
  'A_CYC_BOOST_SPEED_SETTING',
  'A_CYC_HOME_AIR_TEMP_TARGET',
  'A_CYC_AWAY_AIR_TEMP_TARGET',
  'A_CYC_BOOST_AIR_TEMP_TARGET',
  'A_CYC_FILTER_CHANGED_DAY',
  'A_CYC_FILTER_CHANGED_MONTH',
  'A_CYC_FILTER_CHANGED_YEAR',
]);

const TEMPERATURE_REGISTERS = /_AIR_TEMP_TARGET$/;

/** An error the user can read: the unit could not be reached or understood. */
export class ValloxError extends Error {}

/**
 * Send one frame over a fresh WebSocket and resolve the first binary answer.
 * The default transport; the tests replace it.
 * @param {string} host
 * @param {Buffer} frame
 * @param {{ timeout?: number }} options
 * @returns {Promise<Buffer>}
 */
export function webSocketRequest(host, frame, { timeout = REQUEST_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(`ws://${host}/`);
    ws.binaryType = 'arraybuffer';
    const finish = (error, data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // Already closing: nothing to release.
      }
      if (error) reject(error);
      else resolve(data);
    };
    const timer = setTimeout(
      () => finish(new ValloxError(`No answer from ${host} within ${timeout} ms`)),
      timeout,
    );
    ws.addEventListener('open', () => ws.send(frame));
    ws.addEventListener('message', (event) => {
      if (typeof event.data === 'string') return; // never sent by the unit
      finish(null, Buffer.from(event.data));
    });
    ws.addEventListener('error', () => finish(new ValloxError(`Cannot reach ${host}`)));
    ws.addEventListener('close', () =>
      finish(new ValloxError(`${host} closed the connection without answering`)),
    );
  });
}

/**
 * Read the unit's data model script over HTTP.
 * @returns {Promise<string>}
 */
async function httpGetText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(MODEL_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.text();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class ValloxClient {
  /**
   * @param {string} host IP address or host name of the unit (optionally :port)
   * @param {object} [options]
   * @param {typeof webSocketRequest} [options.request] frame transport
   * @param {(url: string) => Promise<string>} [options.getText] HTTP GET of the model
   * @param {number[]} [options.retryDelays] delays between attempts, in ms
   */
  constructor(host, options = {}) {
    this.host = host;
    this.request = options.request ?? webSocketRequest;
    this.getText = options.getText ?? httpGetText;
    this.retryDelays = options.retryDelays ?? RETRY_DELAYS_MS;
    this.model = null;
    this.queue = Promise.resolve();
  }

  // One request at a time per unit; a failed one does not block the next.
  serialize(task) {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  async send(frame) {
    let lastError;
    for (let attempt = 0; attempt <= this.retryDelays.length; attempt += 1) {
      try {
        return await this.request(this.host, frame);
      } catch (error) {
        lastError = error;
        if (attempt < this.retryDelays.length) {
          await sleep(this.retryDelays[attempt]);
        }
      }
    }
    throw lastError instanceof ValloxError
      ? lastError
      : new ValloxError(`Cannot reach ${this.host}: ${lastError?.message ?? lastError}`);
  }

  /**
   * The data model, read from the unit once, the built-in one otherwise.
   * A failed read is tried again at the next request, the built-in model
   * serving in between.
   */
  async loadModel() {
    if (this.model?.source === 'unit') return this.model;
    for (const path of MODEL_PATHS) {
      try {
        const model = modelFromScript(await this.getText(`http://${this.host}/${path}`));
        if (model) {
          logger.info(`${this.host}: data model read from /${path}`);
          this.model = model;
          return model;
        }
      } catch (error) {
        logger.debug(`${this.host}: no data model at /${path} (${error.message})`);
      }
    }
    if (!this.model) {
      logger.info(`${this.host}: using the built-in data model`);
      this.model = builtInModel();
    }
    return this.model;
  }

  /** Every register this integration reads, raw. */
  async readRaw() {
    return this.serialize(async () => {
      const model = await this.loadModel();
      const table = parseTable(await this.send(buildReadTablesRequest()));
      if (table.length < model.tableSize / 2) {
        throw new ValloxError(`${this.host} sent a truncated answer (${table.length} words)`);
      }
      return model.read(table, REGISTERS);
    });
  }

  /** The snapshot of the unit (see metrics.js). */
  async readSnapshot() {
    return toSnapshot(await this.readRaw());
  }

  /**
   * Write registers by name. Temperatures are given in °C.
   * @param {Record<string, number>} values
   */
  async write(values) {
    return this.serialize(async () => {
      const model = await this.loadModel();
      const items = Object.entries(values).map(([name, value]) => {
        if (!WRITABLE.has(name)) {
          throw new ValloxError(`Register ${name} is not writable`);
        }
        const address = model.addressOf(name);
        if (address === undefined) {
          throw new ValloxError(`This unit has no ${name} register`);
        }
        const raw = TEMPERATURE_REGISTERS.test(name) ? toKelvin(value) : Math.round(value);
        return { address, value: raw };
      });
      await this.send(buildWriteRequest(items));
    });
  }
}

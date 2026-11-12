// -----------------------------------------------------------------------------
// What the integration remembers of the units it already met, in /data.
//
// The device of a unit is keyed on the UUID the unit reports: without this
// file, a unit that does not answer when the integration starts (powered off,
// Wi-Fi down) would not be published at all, and its Gladys device would look
// orphaned until it came back. With it, the device is published from memory
// and simply shows as unreachable.
//
// The container rootfs is read-only: /data is the only writable path. A
// failure to read or write is logged and ignored — the file is a cache.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'store' });

export const DEFAULT_DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = 'units.json';

export class UnitStore {
  constructor(dir = DEFAULT_DATA_DIR) {
    this.path = join(dir, FILE);
    this.dir = dir;
  }

  /** @returns {Promise<Record<string, { uuid: string, model: string|null, sw_version: string|null }>>} */
  async load() {
    try {
      const content = JSON.parse(await readFile(this.path, 'utf8'));
      return content && typeof content.units === 'object' ? content.units : {};
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.warn(`Cannot read ${this.path}: ${error.message}`);
      }
      return {};
    }
  }

  async save(units) {
    try {
      await mkdir(this.dir, { recursive: true });
      // Written next to it, then renamed: a crash never leaves half a file.
      const tmp = `${this.path}.tmp`;
      await writeFile(tmp, `${JSON.stringify({ units }, null, 2)}\n`);
      await rename(tmp, this.path);
    } catch (error) {
      logger.warn(`Cannot write ${this.path}: ${error.message}`);
    }
  }
}

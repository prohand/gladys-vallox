// -----------------------------------------------------------------------------
// Entry point of the Vallox integration for Gladys Assistant.
//
// Environment variables provided by the Gladys supervisor to the container
// (read by the SDK itself):
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
//
// Everything else is in src/: the handlers in src/app.js, the units in
// src/units.js, the Vallox protocol in src/vallox/.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { registerHandlers } from './src/app.js';
import { UnitStore } from './src/vallox/store.js';

const gladys = new GladysIntegration();
const { units } = registerHandlers(gladys, { store: new UnitStore() });

// The SDK disconnects cleanly and exits with code 0 when the supervisor stops
// the container (SIGTERM/SIGINT).
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  units.stop();
});

logger.info('Starting the Vallox integration...');
gladys.connect().catch((error) => {
  logger.error('Initial connection failed', error);
  process.exit(1);
});

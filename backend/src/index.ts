import { config } from './config/conifg';
import app from './app';
import db from './db';
import logger from './lib/logger';
import * as chain from './services/chainService';
import * as mqttService from './services/mqttService';
// gt:job-imports

async function start() {
  await db.migrate.latest();
  await db.seed.run();

  // Both degrade to a no-op when unconfigured and log why, so a dev machine
  // with neither a chain nor a broker still boots. `GET /api/health` reports
  // which of them are actually live.
  chain.init();
  mqttService.init();

  // gt:jobs

  app.listen(config.port, () => {
    logger.info(`Server running on port ${config.port} in ${config.env} mode`);
  });
}

start().catch((err) => {
  logger.error(err, 'Failed to start server');
  process.exit(1);
});

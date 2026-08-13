import { config } from './config/conifg';
import app from './app';
import db from './db';
import logger from './lib/logger';
// gt:job-imports

async function start() {
  await db.migrate.latest();
  await db.seed.run();

  // gt:jobs

  app.listen(config.port, () => {
    logger.info(`Server running on port ${config.port} in ${config.env} mode`);
  });
}

start().catch((err) => {
  logger.error(err, 'Failed to start server');
  process.exit(1);
});

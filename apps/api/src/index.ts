import * as Sentry from '@sentry/node';
import {
  createDb,
  createLogger,
  isPgliteUrl,
  loadEnv,
  readServerEnv,
  runMigrations,
  seed,
  type JobPublisher,
} from '@wellthyfy/shared/server';
import { createApp } from './app';
import { createTokenVerifier } from './lib/auth';
import { LoggingPublisher, PgBossPublisher } from './lib/queue';
import { createServices } from './lib/services';
import { seedE2eUsers } from './lib/e2e';

loadEnv();
const env = readServerEnv();
const logger = createLogger('api', env.LOG_LEVEL);

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT,
    // Render sets the deployed commit; it ties each issue to the release that introduced it.
    release: process.env.RENDER_GIT_COMMIT,
    tracesSampleRate: 0.1,
    // api and worker share one Sentry project; the tag tells them apart.
    initialScope: { tags: { service: 'api' } },
  });
}

const handle = await createDb(env.DATABASE_URL);
let publisher: JobPublisher;
let stopPublisher: () => Promise<void> = async () => {};
if (isPgliteUrl(env.DATABASE_URL)) {
  // Local demo / e2e: in-process database, migrated and seeded on boot; no job queue.
  await runMigrations(handle);
  await seed(handle.db);
  if (process.env.E2E_SEED_USERS === '1') await seedE2eUsers(handle.db);
  publisher = new LoggingPublisher(logger);
} else {
  const boss = await PgBossPublisher.start(env.DATABASE_URL, logger);
  publisher = boss;
  stopPublisher = () => boss.stop();
}

const app = createApp({
  db: handle.db,
  env,
  logger,
  publisher,
  verifyToken: createTokenVerifier(env),
  services: createServices(env, logger),
  onUnexpectedError: (err) => env.SENTRY_DSN && Sentry.captureException(err),
});

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, emailMode: env.EMAIL_MODE }, 'api listening');
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  server.close();
  await stopPublisher().catch(() => {});
  await handle.close().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

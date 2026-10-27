import http from 'node:http';
import * as Sentry from '@sentry/node';
import { createDb, createLogger, isPgliteUrl, loadEnv, readServerEnv } from '@wellthyfy/shared/server';
import { ALL_JOBS } from './jobs';
import { registerJobs, startBoss, type WorkerState } from './runtime';

loadEnv();
const env = readServerEnv();
const logger = createLogger('worker', env.LOG_LEVEL);

if (env.SENTRY_DSN) {
  Sentry.init({ dsn: env.SENTRY_DSN, environment: env.SENTRY_ENVIRONMENT, tracesSampleRate: 0 });
}
if (isPgliteUrl(env.DATABASE_URL)) {
  logger.error(
    'The worker needs a real Postgres DATABASE_URL (pg-boss). PGlite is only for tests and the api demo.',
  );
  process.exit(1);
}

const handle = await createDb(env.DATABASE_URL, { max: 5 });
const boss = await startBoss(env, logger);
const state: WorkerState = { startedAt: new Date(), lastHeartbeatAt: null, lastJobAt: {} };
await registerJobs({ db: handle.db, env, logger, boss, now: () => new Date(), state }, ALL_JOBS);
logger.info({ emailMode: env.EMAIL_MODE, jobs: ALL_JOBS.map((j) => j.queue) }, 'worker started');

// Optional health endpoint (Render web services need a port; background workers don't).
const healthPort = Number(process.env.WORKER_HEALTH_PORT || 0);
let server: http.Server | null = null;
if (healthPort) {
  server = http
    .createServer((req, res) => {
      if (req.url !== '/health') {
        res.writeHead(404).end();
        return;
      }
      const stale = !state.lastHeartbeatAt || Date.now() - state.lastHeartbeatAt.getTime() > 5 * 60_000;
      const uptimeOk = Date.now() - state.startedAt.getTime() < 3 * 60_000;
      const ok = !stale || uptimeOk;
      res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: ok ? 'ok' : 'stale',
          service: 'worker',
          emailMode: env.EMAIL_MODE,
          ...state,
        }),
      );
    })
    .listen(healthPort, () => logger.info({ port: healthPort }, 'worker health endpoint listening'));
}

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'worker shutting down (waiting for active jobs)');
  server?.close();
  try {
    await boss.stop({ graceful: true, wait: true, timeout: 30_000 });
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'error stopping pg-boss');
  }
  await handle.close().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

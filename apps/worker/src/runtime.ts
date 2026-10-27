import PgBoss from 'pg-boss';
import { QUEUES, type Db, type Logger, type QueueName, type ServerEnv } from '@wellthyfy/shared/server';

export interface WorkerDeps {
  db: Db;
  env: ServerEnv;
  logger: Logger;
  boss: PgBoss;
  now: () => Date;
  state: WorkerState;
}

export interface WorkerState {
  startedAt: Date;
  lastHeartbeatAt: Date | null;
  lastJobAt: Partial<Record<QueueName, Date>>;
}

export interface JobDefinition {
  queue: QueueName;
  /** Cron expression evaluated in Asia/Kolkata. */
  cron?: string;
  handler: (deps: WorkerDeps, data: Record<string, unknown>) => Promise<void>;
  /** Max parallel jobs (default 1 = one at a time). */
  batchSize?: number;
  pollingIntervalSeconds?: number;
  retryLimit?: number;
}

export async function startBoss(env: ServerEnv, logger: Logger): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString: env.DATABASE_URL, max: 5 });
  boss.on('error', (err) => logger.error({ err: err.message }, 'pg-boss error'));
  await boss.start();
  for (const q of Object.values(QUEUES)) await boss.createQueue(q);
  return boss;
}

export async function registerJobs(deps: WorkerDeps, jobs: JobDefinition[]): Promise<void> {
  const { boss, logger, state } = deps;
  for (const job of jobs) {
    await boss.work<Record<string, unknown>>(
      job.queue,
      { batchSize: job.batchSize ?? 1, pollingIntervalSeconds: job.pollingIntervalSeconds ?? 5 },
      async (batch) => {
        for (const j of batch) {
          const started = Date.now();
          try {
            await job.handler(deps, j.data ?? {});
            state.lastJobAt[job.queue] = new Date();
            logger.debug({ queue: job.queue, ms: Date.now() - started }, 'job done');
          } catch (err) {
            logger.error({ queue: job.queue, err: (err as Error).message }, 'job failed');
            throw err;
          }
        }
      },
    );
    if (job.cron) {
      await boss.schedule(job.queue, job.cron, {}, { tz: 'Asia/Kolkata', retryLimit: job.retryLimit ?? 0 });
    }
  }
}

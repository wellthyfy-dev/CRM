import PgBoss from 'pg-boss';
import type { FetchedPage } from '@wellthyfy/shared';
import {
  QUEUES,
  type AiProvider,
  type Db,
  type EmailVerifier,
  type JobPublisher,
  type Logger,
  type MailTransport,
  type QueueName,
  type ServerEnv,
  type StaffNotifier,
  type WebSearcher,
} from '@wellthyfy/shared/server';

export interface WorkerDeps {
  db: Db;
  env: ServerEnv;
  logger: Logger;
  boss: PgBoss;
  publisher: JobPublisher;
  mail: MailTransport;
  verifier: EmailVerifier;
  ai: AiProvider;
  notifier: StaffNotifier;
  searcher: WebSearcher;
  fetchPages: (website: string) => Promise<FetchedPage[]>;
  /** Parse a raw RFC 822 message (mailparser in production). */
  parseMail: (raw: Buffer) => Promise<ParsedMail>;
  downloadAttachment: (path: string) => Promise<Buffer>;
  now: () => Date;
  /** Random gap between sends, in seconds (60–180 in production). */
  randomGapSeconds: () => number;
  state: WorkerState;
}

export interface ParsedMail {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  fromAddress: string;
  to: string[];
  subject: string;
  text: string;
  date: Date | null;
  headers: Record<string, string>;
  contentType: string;
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

export function bossPublisher(boss: PgBoss): JobPublisher {
  return {
    async send(queue, data, options = {}) {
      await boss.send(queue, data, {
        startAfter: options.startAfterSeconds,
        singletonKey: options.singletonKey,
      });
    },
  };
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

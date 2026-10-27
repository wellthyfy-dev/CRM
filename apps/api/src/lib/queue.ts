import PgBoss from 'pg-boss';
import { QUEUES, type JobPublisher, type Logger, type QueueName } from '@wellthyfy/shared/server';

/** pg-boss publisher for the API: sends jobs only; the worker runs maintenance, schedules and handlers. */
export class PgBossPublisher implements JobPublisher {
  private constructor(private readonly boss: PgBoss) {}

  static async start(connectionString: string, logger: Logger): Promise<PgBossPublisher> {
    const boss = new PgBoss({ connectionString, supervise: false, schedule: false, max: 3 });
    boss.on('error', (err) => logger.error({ err: err.message }, 'pg-boss error'));
    await boss.start();
    for (const q of Object.values(QUEUES)) await boss.createQueue(q);
    return new PgBossPublisher(boss);
  }

  async send(
    queue: QueueName,
    data: Record<string, unknown>,
    options: { startAfterSeconds?: number; singletonKey?: string } = {},
  ): Promise<void> {
    await this.boss.send(queue, data, {
      startAfter: options.startAfterSeconds,
      singletonKey: options.singletonKey,
    });
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, wait: true });
  }
}

/** Used when there is no real Postgres (PGlite e2e/demo): logs jobs instead of queueing them. */
export class LoggingPublisher implements JobPublisher {
  constructor(private readonly logger: Logger) {}
  async send(queue: QueueName, data: Record<string, unknown>): Promise<void> {
    this.logger.info({ queue, data }, 'job (not queued: no pg-boss in this mode)');
  }
}

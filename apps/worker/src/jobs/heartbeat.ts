import { sql } from 'drizzle-orm';
import { QUEUES } from '@wellthyfy/shared/server';
import type { JobDefinition } from '../runtime';

export const heartbeatJob: JobDefinition = {
  queue: QUEUES.heartbeat,
  cron: '* * * * *',
  async handler({ db, logger, state, now, env }) {
    await db.execute(sql`select 1`);
    state.lastHeartbeatAt = now();
    logger.info({ emailMode: env.EMAIL_MODE }, 'heartbeat');
  },
};

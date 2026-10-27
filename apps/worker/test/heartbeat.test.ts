import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type PgBoss from 'pg-boss';
import { createLogger, readServerEnv, type DbHandle } from '@wellthyfy/shared/server';
import { createTestDb } from '@wellthyfy/shared/testing';
import { heartbeatJob } from '../src/jobs/heartbeat';
import type { WorkerDeps } from '../src/runtime';

let h: DbHandle;
beforeAll(async () => {
  h = await createTestDb();
});
afterAll(async () => h.close());

describe('heartbeat job', () => {
  it('pings the database and records the heartbeat', async () => {
    const now = new Date('2026-10-27T05:00:00Z');
    const deps: WorkerDeps = {
      db: h.db,
      env: readServerEnv({ DATABASE_URL: 'pglite://memory' }),
      logger: createLogger('test'),
      boss: {} as PgBoss,
      now: () => now,
      state: { startedAt: now, lastHeartbeatAt: null, lastJobAt: {} },
    };
    await heartbeatJob.handler(deps, {});
    expect(deps.state.lastHeartbeatAt).toEqual(now);
  });
});

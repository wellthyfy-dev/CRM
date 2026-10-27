import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { heartbeatJob } from '../src/jobs/heartbeat';
import { createHarness, type Harness } from './harness';

const NOW = new Date('2026-10-27T05:00:00Z');
let h: Harness;
beforeAll(async () => {
  h = await createHarness(NOW);
});
afterAll(async () => h.handle.close());

describe('heartbeat job', () => {
  it('pings the database and records the heartbeat', async () => {
    await heartbeatJob.handler(h.deps, {});
    expect(h.deps.state.lastHeartbeatAt).toEqual(NOW);
  });
});

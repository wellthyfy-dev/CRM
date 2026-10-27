import request from 'supertest';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { profiles } from '@wellthyfy/shared/server';
import { createTestContext, signToken, USERS, type TestContext } from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(async () => t.handle.close());

describe('api skeleton', () => {
  it('GET /health is public and reports the database', async () => {
    const res = await request(t.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'ok', emailMode: 'dry_run' });
  });

  it('rejects requests without a token', async () => {
    expect((await request(t.app).get('/api/me')).status).toBe(401);
  });

  it('rejects tokens signed with the wrong secret', async () => {
    const bad = await signToken(USERS.admin.id, 'wrong-secret-wrong-secret-wrong!!');
    expect((await request(t.app).get('/api/me').set('Authorization', `Bearer ${bad}`)).status).toBe(401);
  });

  it('rejects users without a profile', async () => {
    const tok = await signToken('00000000-0000-4000-8000-0000000000ff');
    expect((await request(t.app).get('/api/me').set('Authorization', `Bearer ${tok}`)).status).toBe(403);
  });

  it('returns the profile and role', async () => {
    const res = await t.as('researcher').get('/api/me');
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: USERS.researcher.id, role: 'researcher' });
  });

  it('blocks deactivated users', async () => {
    await t.handle.db.update(profiles).set({ active: false }).where(eq(profiles.id, USERS.viewer.id));
    expect((await t.as('viewer').get('/api/me')).status).toBe(403);
    await t.handle.db.update(profiles).set({ active: true }).where(eq(profiles.id, USERS.viewer.id));
  });

  it('applies CORS only for APP_URL', async () => {
    const ok = await request(t.app).get('/health').set('Origin', 'http://localhost:5173');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const bad = await request(t.app).get('/health').set('Origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('returns JSON 404 for unknown routes', async () => {
    const res = await t.as('admin').get('/api/nope');
    expect(res.status).toBe(404);
  });
});

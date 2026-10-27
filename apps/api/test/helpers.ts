import { SignJWT } from 'jose';
import request from 'supertest';
import type { Role } from '@wellthyfy/shared';
import {
  createLogger,
  profiles,
  readServerEnv,
  RecordingPublisher,
  type DbHandle,
} from '@wellthyfy/shared/server';
import { createTestDb } from '@wellthyfy/shared/testing';
import { createApp } from '../src/app';
import { createTokenVerifier } from '../src/lib/auth';
import { createFakeServices } from '../src/lib/fakes';

export const JWT_SECRET = 'test-secret-test-secret-test-secret!';

export const USERS: Record<Role, { id: string; email: string; fullName: string }> = {
  admin: { id: '00000000-0000-4000-8000-00000000000a', email: 'admin@wellthyfy.in', fullName: 'Admin User' },
  researcher: {
    id: '00000000-0000-4000-8000-00000000000b',
    email: 'research@wellthyfy.in',
    fullName: 'Research User',
  },
  viewer: {
    id: '00000000-0000-4000-8000-00000000000c',
    email: 'viewer@wellthyfy.in',
    fullName: 'Viewer User',
  },
};

export async function signToken(sub: string, secret = JWT_SECRET): Promise<string> {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret));
}

export interface TestContext {
  handle: DbHandle;
  app: ReturnType<typeof createApp>;
  publisher: RecordingPublisher;
  services: ReturnType<typeof createFakeServices>;
  tokens: Record<Role, string>;
  as: (role: Role) => {
    get: (url: string) => request.Test;
    post: (url: string, body?: object) => request.Test;
    patch: (url: string, body?: object) => request.Test;
    put: (url: string, body?: object) => request.Test;
    delete: (url: string) => request.Test;
  };
  now: { value: Date };
}

export async function createTestContext(opts: { now?: Date } = {}): Promise<TestContext> {
  const handle = await createTestDb();
  for (const [role, u] of Object.entries(USERS)) {
    await handle.db.insert(profiles).values({ ...u, role: role as Role, active: true });
  }
  const env = readServerEnv({
    DATABASE_URL: 'pglite://memory',
    SUPABASE_JWT_SECRET: JWT_SECRET,
    EMAIL_MODE: 'dry_run',
    APP_URL: 'http://localhost:5173',
    NODE_ENV: 'test',
  });
  const publisher = new RecordingPublisher();
  const services = createFakeServices();
  const now = { value: opts.now ?? new Date() };
  const app = createApp({
    db: handle.db,
    env,
    logger: createLogger('api-test'),
    publisher,
    verifyToken: createTokenVerifier(env),
    services,
    now: () => now.value,
  });
  const tokens = {
    admin: await signToken(USERS.admin.id),
    researcher: await signToken(USERS.researcher.id),
    viewer: await signToken(USERS.viewer.id),
  };
  const as = (role: Role) => {
    const auth = `Bearer ${tokens[role]}`;
    return {
      get: (url: string) => request(app).get(url).set('Authorization', auth),
      post: (url: string, body: object = {}) => request(app).post(url).set('Authorization', auth).send(body),
      patch: (url: string, body: object = {}) =>
        request(app).patch(url).set('Authorization', auth).send(body),
      put: (url: string, body: object = {}) => request(app).put(url).set('Authorization', auth).send(body),
      delete: (url: string) => request(app).delete(url).set('Authorization', auth),
    };
  };
  return { handle, app, publisher, services, tokens, as, now };
}

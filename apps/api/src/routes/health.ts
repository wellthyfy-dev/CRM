import { Router } from 'express';
import { sql } from 'drizzle-orm';
import type { RouteDeps } from '../app';

export function healthRoutes({ db, env }: RouteDeps): Router {
  const r = Router();
  r.get('/health', async (_req, res) => {
    let database = 'ok';
    try {
      await db.execute(sql`select 1`);
    } catch {
      database = 'error';
    }
    res.status(database === 'ok' ? 200 : 503).json({
      status: database === 'ok' ? 'ok' : 'degraded',
      service: 'api',
      database,
      emailMode: env.EMAIL_MODE,
      time: new Date().toISOString(),
    });
  });
  return r;
}

import { Router } from 'express';
import { asc, desc, eq } from 'drizzle-orm';
import { programmeSchema } from '@wellthyfy/shared';
import { logActivity, programmes } from '@wellthyfy/shared/server';
import type { RouteDeps } from '../app';
import { adminOnly, currentUser } from '../lib/auth';
import { notFound } from '../lib/errors';
import { idParam, parseBody } from '../lib/http';

export function programmeRoutes({ db }: RouteDeps): Router {
  const r = Router();

  r.get('/programmes', async (_req, res) => {
    res.json(await db.select().from(programmes).orderBy(desc(programmes.active), asc(programmes.name)));
  });

  r.post('/programmes', adminOnly, async (req, res) => {
    const user = currentUser(req);
    const body = parseBody(programmeSchema, req);
    const [row] = await db.insert(programmes).values(body).returning();
    await logActivity(db, {
      userId: user.id,
      type: 'programme_created',
      payload: { programmeId: row!.id, name: row!.name },
    });
    res.status(201).json(row);
  });

  r.put('/programmes/:id', adminOnly, async (req, res) => {
    const user = currentUser(req);
    const id = idParam(req);
    const body = parseBody(programmeSchema, req);
    const [row] = await db.update(programmes).set(body).where(eq(programmes.id, id)).returning();
    if (!row) throw notFound('Programme not found');
    await logActivity(db, {
      userId: user.id,
      type: 'programme_updated',
      payload: { programmeId: id, name: row.name },
    });
    res.json(row);
  });

  return r;
}

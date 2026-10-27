import { Router } from 'express';
import { and, asc, count, eq, ne } from 'drizzle-orm';
import { userInviteSchema, userUpdateSchema } from '@wellthyfy/shared';
import { logActivity, profiles } from '@wellthyfy/shared/server';
import type { RouteDeps } from '../app';
import { adminOnly, currentUser } from '../lib/auth';
import { badRequest, conflict, notFound } from '../lib/errors';
import { idParam, parseBody } from '../lib/http';

export function userRoutes({ db, services }: RouteDeps): Router {
  const r = Router();

  /** Basic directory for owner pickers (all roles). */
  r.get('/users/directory', async (_req, res) => {
    res.json(
      await db
        .select({ id: profiles.id, fullName: profiles.fullName, role: profiles.role })
        .from(profiles)
        .where(eq(profiles.active, true))
        .orderBy(asc(profiles.fullName)),
    );
  });

  r.get('/users', adminOnly, async (_req, res) => {
    res.json(await db.select().from(profiles).orderBy(asc(profiles.fullName)));
  });

  r.post('/users/invite', adminOnly, async (req, res) => {
    const user = currentUser(req);
    const body = parseBody(userInviteSchema, req);
    const [dupe] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.email, body.email));
    if (dupe) throw conflict('A user with this email already exists');
    const { id } = await services.users.invite(body.email, body.fullName);
    const [profile] = await db
      .insert(profiles)
      .values({ id, email: body.email, fullName: body.fullName, role: body.role, active: true })
      .onConflictDoUpdate({
        target: profiles.id,
        set: { role: body.role, fullName: body.fullName, active: true },
      })
      .returning();
    await logActivity(db, {
      userId: user.id,
      type: 'user_invited',
      payload: { profileId: id, email: body.email, role: body.role },
    });
    res.status(201).json(profile);
  });

  r.patch('/users/:id', adminOnly, async (req, res) => {
    const user = currentUser(req);
    const id = idParam(req);
    const body = parseBody(userUpdateSchema, req);
    const [target] = await db.select().from(profiles).where(eq(profiles.id, id));
    if (!target) throw notFound('User not found');
    const demotingAdmin =
      target.role === 'admin' && ((body.role && body.role !== 'admin') || body.active === false);
    if (demotingAdmin) {
      if (id === user.id) throw badRequest('You cannot remove your own admin access');
      const [{ n } = { n: 0 }] = await db
        .select({ n: count() })
        .from(profiles)
        .where(and(eq(profiles.role, 'admin'), eq(profiles.active, true), ne(profiles.id, id)));
      if (Number(n) === 0) throw badRequest('At least one active admin is required');
    }
    const [updated] = await db.update(profiles).set(body).where(eq(profiles.id, id)).returning();
    await logActivity(db, { userId: user.id, type: 'user_updated', payload: { profileId: id, ...body } });
    res.json(updated);
  });

  return r;
}

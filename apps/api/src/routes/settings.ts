import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';
import { settingsUpdateSchema } from '@wellthyfy/shared';
import {
  activities,
  effectiveOptOutLine,
  getSettings,
  logActivity,
  profiles,
  settings,
  titanConfigured,
} from '@wellthyfy/shared/server';
import type { RouteDeps } from '../app';
import { adminOnly, currentUser } from '../lib/auth';
import { parseBody } from '../lib/http';

export function settingsRoutes({ db, env, services }: RouteDeps): Router {
  const r = Router();

  /** Settings plus which integrations are configured (booleans only — never secrets). */
  r.get('/settings', async (_req, res) => {
    const s = await getSettings(db);
    res.json({
      settings: { ...s, effectiveOptOutLine: effectiveOptOutLine(s) },
      integrations: {
        emailMode: env.EMAIL_MODE,
        titan: titanConfigured(env),
        titanUser: env.TITAN_USER ?? null,
        resend: !!env.RESEND_API_KEY && !!env.ALERT_EMAIL_TO,
        anthropic: !!env.ANTHROPIC_API_KEY,
        serper: !!env.SERPER_API_KEY,
        zerobounce: !!env.ZEROBOUNCE_API_KEY,
        storage: !!env.SUPABASE_URL && !!env.SUPABASE_SERVICE_ROLE_KEY,
        sentry: !!env.SENTRY_DSN,
      },
      aiModels: { default: env.AI_MODEL_DEFAULT, optional: env.AI_MODEL_OPTIONAL },
    });
  });

  r.patch('/settings', adminOnly, async (req, res) => {
    const user = currentUser(req);
    const body = parseBody(settingsUpdateSchema, req);
    if (body.aiModel && ![env.AI_MODEL_DEFAULT, env.AI_MODEL_OPTIONAL].includes(body.aiModel)) {
      body.aiModel = env.AI_MODEL_DEFAULT;
    }
    await getSettings(db);
    const [updated] = await db.update(settings).set(body).where(eq(settings.id, 1)).returning();
    await logActivity(db, {
      userId: user.id,
      type: 'settings_updated',
      payload: { fields: Object.keys(body) },
    });
    res.json(updated);
  });

  /** IMAP login + folder list and SMTP verify — pass/fail only. */
  r.post('/settings/test-titan', adminOnly, async (req, res) => {
    const user = currentUser(req);
    const result = await services.titan.testConnection();
    await logActivity(db, {
      userId: user.id,
      type: 'titan_connection_tested',
      payload: { imap: result.imap, smtp: result.smtp },
    });
    res.json(result);
  });

  r.get('/activities', adminOnly, async (_req, res) => {
    res.json(
      await db
        .select({
          id: activities.id,
          type: activities.type,
          payload: activities.payload,
          organisationId: activities.organisationId,
          createdAt: activities.createdAt,
          userName: profiles.fullName,
        })
        .from(activities)
        .leftJoin(profiles, eq(profiles.id, activities.userId))
        .orderBy(desc(activities.createdAt))
        .limit(300),
    );
  });

  return r;
}

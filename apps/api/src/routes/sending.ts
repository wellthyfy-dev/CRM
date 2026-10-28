import { Router } from 'express';
import { and, asc, count, desc, eq, gte, isNotNull } from 'drizzle-orm';
import {
  nextSendOpportunity,
  replyListQuerySchema,
  replyUpdateSchema,
  startOfIstDay,
  startOfIstHour,
} from '@wellthyfy/shared';
import {
  aiApiKey,
  aiKeyName,
  aiSpendThisMonth,
  checkSendGate,
  contacts,
  emails,
  getSettings,
  isSuppressed,
  logActivity,
  organisations,
  QUEUES,
  replies,
  research,
  settings,
  type Db,
} from '@wellthyfy/shared/server';
import { z } from 'zod';
import type { RouteDeps } from '../app';
import { adminOnly, canEdit, currentUser, type AuthUser } from '../lib/auth';
import { assertContactEmailFree, getOrg } from '../lib/crm';
import { badRequest, notFound } from '../lib/errors';
import { idParam, parseBody, parseQuery } from '../lib/http';

async function queueEmail(deps: RouteDeps, id: string, user: AuthUser) {
  const { db, now } = deps;
  // The gate runs at queue time too; timing rules (caps/window) are enforced by the worker right before SMTP.
  const gate = await checkSendGate(db, id, { stage: 'queue', now: now() });
  if (!gate.ok) return { id, ok: false, reasons: gate.blocking.map((f) => f.message) };
  const [e] = await db
    .update(emails)
    .set({ status: 'queued', queuedAt: now(), scheduledFor: null, error: null })
    .where(and(eq(emails.id, id), eq(emails.status, 'approved')))
    .returning();
  if (!e) return { id, ok: false, reasons: ['Email is no longer approved'] };
  await logActivity(db, {
    organisationId: e.organisationId,
    userId: user.id,
    type: 'email_queued',
    payload: { emailId: id },
  });
  return { id, ok: true };
}

export async function queueStatus(db: Db, now: Date) {
  const s = await getSettings(db);
  const sinceDay = startOfIstDay(now);
  const sinceHour = startOfIstHour(now);
  const [today] = await db
    .select({ n: count() })
    .from(emails)
    .where(and(isNotNull(emails.sentAt), gte(emails.sentAt, sinceDay)));
  const [hour] = await db
    .select({ n: count() })
    .from(emails)
    .where(and(isNotNull(emails.sentAt), gte(emails.sentAt, sinceHour)));
  const queued = await db
    .select({
      id: emails.id,
      subject: emails.subject,
      kind: emails.kind,
      followUpNo: emails.followUpNo,
      queuedAt: emails.queuedAt,
      scheduledFor: emails.scheduledFor,
      sendAttempts: emails.sendAttempts,
      error: emails.error,
      gateFailureReason: emails.gateFailureReason,
      organisationId: emails.organisationId,
      organisationName: organisations.name,
      contactEmail: contacts.email,
    })
    .from(emails)
    .innerJoin(organisations, eq(organisations.id, emails.organisationId))
    .leftJoin(contacts, eq(contacts.id, emails.contactId))
    .where(eq(emails.status, 'queued'))
    .orderBy(asc(emails.queuedAt));
  const sentToday = Number(today?.n ?? 0);
  const sentThisHour = Number(hour?.n ?? 0);
  const pausedUntil = s.queuePausedUntil && s.queuePausedUntil > now ? s.queuePausedUntil : null;
  return {
    queued,
    sentToday,
    sentThisHour,
    dailyCap: s.dailySendCap,
    hourlyCap: s.hourlySendCap,
    remainingToday: Math.max(0, s.dailySendCap - sentToday),
    remainingThisHour: Math.max(0, s.hourlySendCap - sentThisHour),
    paused: s.queuePaused || !!pausedUntil,
    pausedUntil,
    pauseReason: s.queuePaused || pausedUntil ? s.queuePauseReason : null,
    nextSendAfter: s.nextSendAfter && s.nextSendAfter > now ? s.nextSendAfter : null,
    nextWindow: nextSendOpportunity(now, s.sendWindowStart, s.sendWindowEnd, s.sendDays),
    window: { start: s.sendWindowStart, end: s.sendWindowEnd, days: s.sendDays },
  };
}

const addCandidateSchema = z.object({ index: z.number().int().min(0) });

export function sendingRoutes(deps: RouteDeps): Router {
  const { db, now, publisher, env } = deps;
  const r = Router();

  // ---- Sending ---------------------------------------------------------------
  r.post('/emails/:id/send', adminOnly, async (req, res) => {
    const result = await queueEmail(deps, idParam(req), currentUser(req));
    if (!result.ok) throw badRequest(`Cannot send: ${result.reasons?.join('; ')}`, result);
    await publisher.send(QUEUES.sendTick, {});
    res.json(result);
  });

  r.post('/emails/send-approved', adminOnly, async (req, res) => {
    const user = currentUser(req);
    const approved = await db.select({ id: emails.id }).from(emails).where(eq(emails.status, 'approved'));
    const results = [];
    for (const e of approved) results.push(await queueEmail(deps, e.id, user));
    if (results.some((x) => x.ok)) await publisher.send(QUEUES.sendTick, {});
    res.json({ queued: results.filter((x) => x.ok).length, results });
  });

  r.get('/queue', adminOnly, async (_req, res) => {
    res.json(await queueStatus(db, now()));
  });

  r.post('/queue/pause', adminOnly, async (req, res) => {
    const user = currentUser(req);
    const reason = String((req.body as { reason?: string })?.reason ?? 'Paused by an admin').slice(0, 300);
    await db.update(settings).set({ queuePaused: true, queuePauseReason: reason }).where(eq(settings.id, 1));
    await logActivity(db, { userId: user.id, type: 'queue_paused', payload: { reason } });
    res.json(await queueStatus(db, now()));
  });

  r.post('/queue/resume', adminOnly, async (req, res) => {
    const user = currentUser(req);
    await db
      .update(settings)
      .set({ queuePaused: false, queuePausedUntil: null, queuePauseReason: null })
      .where(eq(settings.id, 1));
    await logActivity(db, { userId: user.id, type: 'queue_resumed', payload: {} });
    await publisher.send(QUEUES.sendTick, {});
    res.json(await queueStatus(db, now()));
  });

  /** Remove an email from the queue back to approved (not sent). */
  r.post('/emails/:id/unqueue', adminOnly, async (req, res) => {
    const user = currentUser(req);
    const id = idParam(req);
    const [e] = await db
      .update(emails)
      .set({ status: 'approved', queuedAt: null, scheduledFor: null })
      .where(and(eq(emails.id, id), eq(emails.status, 'queued')))
      .returning();
    if (!e) throw badRequest('Email is not queued');
    await logActivity(db, {
      organisationId: e.organisationId,
      userId: user.id,
      type: 'email_unqueued',
      payload: { emailId: id },
    });
    res.json(e);
  });

  // ---- Replies ---------------------------------------------------------------
  r.get('/replies', async (req, res) => {
    const q = parseQuery(replyListQuerySchema, req);
    const where = [];
    if (q.classification) where.push(eq(replies.classification, q.classification));
    if (q.handled !== undefined) where.push(eq(replies.handled, q.handled));
    const cond = where.length ? and(...where) : undefined;
    const items = await db
      .select({
        reply: replies,
        organisationName: organisations.name,
        contactName: contacts.fullName,
        emailSubject: emails.subject,
      })
      .from(replies)
      .leftJoin(organisations, eq(organisations.id, replies.organisationId))
      .leftJoin(contacts, eq(contacts.id, replies.contactId))
      .leftJoin(emails, eq(emails.id, replies.emailId))
      .where(cond)
      .orderBy(desc(replies.receivedAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(replies).where(cond);
    res.json({
      items: items.map((x) => ({
        ...x.reply,
        organisationName: x.organisationName,
        contactName: x.contactName,
        emailSubject: x.emailSubject,
      })),
      total: Number(n),
      page: q.page,
      pageSize: q.pageSize,
    });
  });

  r.patch('/replies/:id', canEdit, async (req, res) => {
    const user = currentUser(req);
    const id = idParam(req);
    const body = parseBody(replyUpdateSchema, req);
    const [row] = await db
      .update(replies)
      .set({
        ...body,
        ...(body.handled !== undefined
          ? { handledBy: body.handled ? user.id : null, handledAt: body.handled ? now() : null }
          : {}),
      })
      .where(eq(replies.id, id))
      .returning();
    if (!row) throw notFound('Reply not found');
    await logActivity(db, {
      organisationId: row.organisationId,
      userId: user.id,
      type: 'reply_updated',
      payload: { replyId: id, ...body },
    });
    res.json(row);
  });

  // ---- AI research -----------------------------------------------------------
  r.get('/ai/usage', async (_req, res) => {
    const s = await getSettings(db);
    res.json({
      spentInr: await aiSpendThisMonth(db, now()),
      limitInr: Number(s.aiMonthlyLimitInr),
      configured: !!aiApiKey(env),
    });
  });

  r.post('/organisations/:id/research/ai', canEdit, async (req, res) => {
    const user = currentUser(req);
    const org = await getOrg(db, idParam(req));
    if (!org.website) throw badRequest('Add the official website first');
    if (!aiApiKey(env)) throw badRequest(`AI is not configured (${aiKeyName(env)})`);
    const s = await getSettings(db);
    if ((await aiSpendThisMonth(db, now())) >= Number(s.aiMonthlyLimitInr)) {
      throw badRequest('Monthly AI limit reached — raise it in Settings');
    }
    await publisher.send(QUEUES.aiResearch, { organisationId: org.id, userId: user.id });
    await logActivity(db, {
      organisationId: org.id,
      userId: user.id,
      type: 'ai_research_requested',
      payload: {},
    });
    res.status(202).json({ queued: true });
  });

  /** One-click add of an AI-suggested contact: always unverified (safety rule 3). */
  r.post('/research/:id/candidates', canEdit, async (req, res) => {
    const user = currentUser(req);
    const [row] = await db
      .select()
      .from(research)
      .where(eq(research.id, idParam(req)));
    if (!row?.aiGenerated) throw notFound('AI research not found');
    const { index } = parseBody(addCandidateSchema, req);
    const candidates =
      (
        row.aiOutput as {
          candidateContacts?: { name: string; designation: string; email: string; sourceUrl: string }[];
        }
      )?.candidateContacts ?? [];
    const c = candidates[index];
    if (!c) throw notFound('Candidate not found');
    const email = c.email ? c.email.trim().toLowerCase() : null;
    await assertContactEmailFree(db, email);
    const suppressed = email ? await isSuppressed(db, email) : false;
    const existing = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.organisationId, row.organisationId));
    const [contact] = await db
      .insert(contacts)
      .values({
        organisationId: row.organisationId,
        fullName: c.name,
        designation: c.designation || null,
        email,
        sourceUrl: c.sourceUrl,
        verified: false,
        aiSuggested: true,
        optOut: suppressed,
        optOutAt: suppressed ? now() : null,
        isPrimary: existing.length === 0,
      })
      .returning();
    await logActivity(db, {
      organisationId: row.organisationId,
      userId: user.id,
      type: 'contact_created',
      payload: { contactId: contact!.id, source: 'ai_suggestion', researchId: row.id },
    });
    if (email) await publisher.send(QUEUES.verifyEmail, { contactId: contact!.id });
    res.status(201).json(contact);
  });

  return r;
}

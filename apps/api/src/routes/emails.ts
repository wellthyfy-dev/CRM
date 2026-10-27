import { Router } from 'express';
import { and, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import {
  bulkIdsSchema,
  emailCreateSchema,
  emailListQuerySchema,
  emailRejectSchema,
  emailRenderSchema,
  emailUpdateSchema,
  ensureOptOutLine,
  evaluateSendGate,
  ZEROBOUNCE_MAX_AGE_DAYS,
} from '@wellthyfy/shared';
import {
  contacts,
  effectiveOptOutLine,
  emails,
  getSettings,
  loadGateContext,
  logActivity,
  organisations,
  profiles,
  programmes,
  QUEUES,
  research,
  templates,
  type Db,
  type Email,
} from '@wellthyfy/shared/server';
import type { RouteDeps } from '../app';
import { adminOnly, canEdit, currentUser, type AuthUser } from '../lib/auth';
import {
  advanceOrg,
  getContact,
  getOrg,
  latestResearch,
  renderForContact,
  requireVerifiedContact,
  resolveTemplate,
} from '../lib/crm';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { idParam, parseBody, parseQuery } from '../lib/http';
import type { Services } from '../lib/services';

async function getEmail(db: Db, id: string): Promise<Email> {
  const [e] = await db.select().from(emails).where(eq(emails.id, id));
  if (!e) throw notFound('Email not found');
  return e;
}

/** Warnings shown on the approval screen (do not block). */
function verificationWarnings(
  c: { emailCheckStatus: string; emailCheckedAt: Date | null },
  now: Date,
): string[] {
  const w: string[] = [];
  if (c.emailCheckStatus === 'catch_all')
    w.push('Email verification: catch-all domain (delivery not guaranteed)');
  if (c.emailCheckStatus === 'risky') w.push('Email verification: risky address');
  if (c.emailCheckStatus === 'unknown') w.push('Email has not been verified with ZeroBounce yet');
  if (c.emailCheckedAt && now.getTime() - c.emailCheckedAt.getTime() > ZEROBOUNCE_MAX_AGE_DAYS * 86400000) {
    w.push(`Email verification is older than ${ZEROBOUNCE_MAX_AGE_DAYS} days`);
  }
  return w;
}

export interface ApproveResult {
  id: string;
  ok: boolean;
  reasons?: string[];
}

/**
 * Record a human approval (safety rule 1). Pre-checks every non-timing gate rule as if approved, so an email that
 * could never pass the gate is not approved. Re-verifies the address with ZeroBounce if the check is >90 days old.
 */
export async function approveEmail(
  deps: { db: Db; publisher: RouteDeps['publisher']; services: Services; now: () => Date },
  emailId: string,
  user: AuthUser,
): Promise<ApproveResult> {
  const { db, publisher, services, now } = deps;
  const email = await getEmail(db, emailId);
  if (!['draft', 'pending_approval'].includes(email.status)) {
    return {
      id: emailId,
      ok: false,
      reasons: [`Email is ${email.status}; only drafts awaiting approval can be approved`],
    };
  }
  if (email.contactId) {
    const c = await getContact(db, email.contactId);
    const stale =
      !c.emailCheckedAt || now().getTime() - c.emailCheckedAt.getTime() > ZEROBOUNCE_MAX_AGE_DAYS * 86400000;
    if (c.email && stale && services.emailVerifier.configured) {
      const status = await services.emailVerifier.verify(c.email).catch(() => null);
      if (status) {
        await db
          .update(contacts)
          .set({ emailCheckStatus: status, emailCheckedAt: now() })
          .where(eq(contacts.id, c.id));
      }
    }
  }
  const ctx = await loadGateContext(db, emailId, 'queue', now());
  if (!ctx) throw notFound('Email not found');
  ctx.email = { ...ctx.email, status: 'approved', approvedBy: user.id, approvedAt: now() };
  const gate = evaluateSendGate(ctx);
  if (!gate.ok) return { id: emailId, ok: false, reasons: gate.blocking.map((f) => f.message) };

  await db
    .update(emails)
    .set({
      status: 'approved',
      approvedBy: user.id,
      approvedAt: now(),
      rejectionReason: null,
      gateFailureReason: null,
    })
    .where(eq(emails.id, emailId));
  await logActivity(db, {
    organisationId: email.organisationId,
    userId: user.id,
    type: 'email_approved',
    payload: { emailId, subject: email.subject, kind: email.kind },
  });
  await advanceOrg(db, email.organisationId, 'approved', user.id, 'email approved');
  // Create the Titan draft for review in webmail (worker; dry_run logs only).
  await publisher.send(QUEUES.imapDraft, { emailId });
  return { id: emailId, ok: true };
}

export function emailRoutes(deps: RouteDeps): Router {
  const { db, now } = deps;
  const r = Router();

  r.post('/emails/render', canEdit, async (req, res) => {
    const body = parseBody(emailRenderSchema, req);
    const org = await getOrg(db, body.organisationId);
    const contact = await getContact(db, body.contactId);
    if (contact.organisationId !== org.id) throw badRequest('Contact does not belong to this organisation');
    const template = await resolveTemplate(db, org, body.templateId);
    const rendered = await renderForContact(db, org, contact, template);
    res.json({
      templateId: template.id,
      templateKey: template.key,
      templateVersion: template.version,
      subject: rendered.subject,
      body: rendered.body,
    });
  });

  r.post('/emails', canEdit, async (req, res) => {
    const user = currentUser(req);
    const body = parseBody(emailCreateSchema, req);
    const org = await getOrg(db, body.organisationId);
    const contact = await getContact(db, body.contactId);
    if (contact.organisationId !== org.id) throw badRequest('Contact does not belong to this organisation');
    requireVerifiedContact(contact);
    if (org.doNotContact) throw badRequest('Organisation is marked do-not-contact');
    const template = await resolveTemplate(db, org, body.templateId);
    const rendered = await renderForContact(db, org, contact, template);
    const subject = body.subject?.trim() || rendered.subject;
    const text = ensureOptOutLine(body.body?.trim() || rendered.body, rendered.optOutLine);
    const [created] = await db
      .insert(emails)
      .values({
        organisationId: org.id,
        contactId: contact.id,
        templateId: template.id,
        templateVersion: template.version,
        kind: 'first_contact',
        followUpNo: 0,
        subject,
        body: text,
        status: 'draft',
        createdBy: user.id,
      })
      .returning();
    const [email] = await db
      .update(emails)
      .set({ threadId: created!.id })
      .where(eq(emails.id, created!.id))
      .returning();
    await logActivity(db, {
      organisationId: org.id,
      userId: user.id,
      type: 'email_drafted',
      payload: { emailId: email!.id, subject, templateKey: template.key, templateVersion: template.version },
    });
    res.status(201).json(email);
  });

  r.get('/emails', async (req, res) => {
    const q = parseQuery(emailListQuerySchema, req);
    const where: SQL[] = [];
    if (q.status) where.push(eq(emails.status, q.status));
    if (q.organisationId) where.push(eq(emails.organisationId, q.organisationId));
    if (q.q) {
      const like = `%${q.q}%`;
      where.push(
        or(ilike(emails.subject, like), ilike(organisations.name, like), ilike(contacts.email, like))!,
      );
    }
    const cond = where.length ? and(...where) : undefined;
    const items = await db
      .select({
        id: emails.id,
        status: emails.status,
        kind: emails.kind,
        followUpNo: emails.followUpNo,
        subject: emails.subject,
        organisationId: emails.organisationId,
        organisationName: organisations.name,
        recordId: organisations.recordId,
        contactId: emails.contactId,
        contactName: contacts.fullName,
        contactEmail: contacts.email,
        approvedAt: emails.approvedAt,
        sentAt: emails.sentAt,
        scheduledFor: emails.scheduledFor,
        gateFailureReason: emails.gateFailureReason,
        rejectionReason: emails.rejectionReason,
        error: emails.error,
        createdAt: emails.createdAt,
        updatedAt: emails.updatedAt,
      })
      .from(emails)
      .innerJoin(organisations, eq(organisations.id, emails.organisationId))
      .leftJoin(contacts, eq(contacts.id, emails.contactId))
      .where(cond)
      .orderBy(desc(emails.updatedAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const [{ n } = { n: 0 }] = await db
      .select({ n: count() })
      .from(emails)
      .innerJoin(organisations, eq(organisations.id, emails.organisationId))
      .leftJoin(contacts, eq(contacts.id, emails.contactId))
      .where(cond);
    res.json({ items, total: Number(n), page: q.page, pageSize: q.pageSize });
  });

  /** Approval queue: each email beside its contact, source URL, research and verification warnings. */
  r.get('/approvals', adminOnly, async (_req, res) => {
    const rows = await db
      .select({ email: emails, contact: contacts, organisation: organisations })
      .from(emails)
      .innerJoin(organisations, eq(organisations.id, emails.organisationId))
      .leftJoin(contacts, eq(contacts.id, emails.contactId))
      .where(eq(emails.status, 'pending_approval'))
      .orderBy(emails.submittedAt);
    const out = [];
    for (const row of rows) {
      const r0 = await latestResearch(db, row.organisation.id);
      const programme = r0?.recommendedProgrammeId
        ? ((
            await db
              .select({ name: programmes.name })
              .from(programmes)
              .where(eq(programmes.id, r0.recommendedProgrammeId))
          )[0] ?? null)
        : null;
      const [submitter] = row.email.submittedBy
        ? await db
            .select({ fullName: profiles.fullName })
            .from(profiles)
            .where(eq(profiles.id, row.email.submittedBy))
        : [];
      out.push({
        ...row,
        research: r0 ? { ...r0, programmeName: programme?.name ?? null } : null,
        submittedByName: submitter?.fullName ?? null,
        warnings: row.contact ? verificationWarnings(row.contact, now()) : [],
      });
    }
    res.json(out);
  });

  r.get('/emails/:id', async (req, res) => {
    const email = await getEmail(db, idParam(req));
    const org = await getOrg(db, email.organisationId);
    const contact = email.contactId ? await getContact(db, email.contactId) : null;
    const [template] = email.templateId
      ? await db
          .select({ key: templates.key, name: templates.name })
          .from(templates)
          .where(eq(templates.id, email.templateId))
      : [];
    const [r0] = await db
      .select()
      .from(research)
      .where(eq(research.organisationId, org.id))
      .orderBy(desc(research.createdAt))
      .limit(1);
    const ctx = await loadGateContext(db, email.id, email.status === 'queued' ? 'send' : 'preview', now());
    // For drafts awaiting approval, show what would block it once approved (not the missing approval itself).
    if (ctx && ['draft', 'pending_approval'].includes(email.status)) {
      ctx.email = { ...ctx.email, status: 'approved', approvedBy: 'preview', approvedAt: now() };
    }
    const gate =
      ctx && !['sent', 'replied', 'bounced', 'cancelled'].includes(email.status)
        ? evaluateSendGate(ctx)
        : null;
    const thread = email.threadId
      ? await db
          .select({
            id: emails.id,
            kind: emails.kind,
            status: emails.status,
            subject: emails.subject,
            sentAt: emails.sentAt,
          })
          .from(emails)
          .where(eq(emails.threadId, email.threadId))
          .orderBy(emails.createdAt)
      : [];
    res.json({
      email,
      organisation: org,
      contact,
      template: template ?? null,
      research: r0 ?? null,
      gate,
      thread,
      warnings: contact ? verificationWarnings(contact, now()) : [],
    });
  });

  r.patch('/emails/:id', canEdit, async (req, res) => {
    const user = currentUser(req);
    const email = await getEmail(db, idParam(req));
    const body = parseBody(emailUpdateSchema, req);
    const editable = user.role === 'admin' ? ['draft', 'pending_approval'] : ['draft'];
    if (!editable.includes(email.status)) {
      throw badRequest(
        user.role === 'admin'
          ? `Cannot edit an email that is ${email.status}`
          : 'Only drafts can be edited; ask an admin to edit emails awaiting approval',
      );
    }
    const s = await getSettings(db);
    const patch: Partial<typeof emails.$inferInsert> = {};
    if (body.subject !== undefined) patch.subject = body.subject;
    if (body.body !== undefined) patch.body = ensureOptOutLine(body.body, effectiveOptOutLine(s));
    const [updated] = await db.update(emails).set(patch).where(eq(emails.id, email.id)).returning();
    await logActivity(db, {
      organisationId: email.organisationId,
      userId: user.id,
      type: 'email_edited',
      payload: { emailId: email.id, fields: Object.keys(patch), status: email.status },
    });
    res.json(updated);
  });

  r.post('/emails/:id/submit', canEdit, async (req, res) => {
    const user = currentUser(req);
    const email = await getEmail(db, idParam(req));
    if (email.status !== 'draft') throw badRequest(`Email is ${email.status}, not a draft`);
    if (email.contactId) requireVerifiedContact(await getContact(db, email.contactId));
    const [updated] = await db
      .update(emails)
      .set({ status: 'pending_approval', submittedBy: user.id, submittedAt: now() })
      .where(eq(emails.id, email.id))
      .returning();
    await logActivity(db, {
      organisationId: email.organisationId,
      userId: user.id,
      type: 'email_submitted',
      payload: { emailId: email.id, subject: email.subject },
    });
    res.json(updated);
  });

  r.post('/emails/:id/approve', adminOnly, async (req, res) => {
    const result = await approveEmail(deps, idParam(req), currentUser(req));
    if (!result.ok) throw badRequest(`Cannot approve: ${result.reasons?.join('; ')}`, result);
    res.json({ ...result, email: await getEmail(db, result.id) });
  });

  /** Bulk approve: the UI shows every email first; each is still checked individually. */
  r.post('/emails/bulk-approve', adminOnly, async (req, res) => {
    const user = currentUser(req);
    const { ids } = parseBody(bulkIdsSchema, req);
    const results: ApproveResult[] = [];
    for (const id of ids) results.push(await approveEmail(deps, id, user));
    res.json({ results, approved: results.filter((x) => x.ok).length });
  });

  r.post('/emails/:id/reject', adminOnly, async (req, res) => {
    const user = currentUser(req);
    const email = await getEmail(db, idParam(req));
    const { reason } = parseBody(emailRejectSchema, req);
    if (!['pending_approval', 'approved'].includes(email.status)) {
      throw badRequest(`Cannot reject an email that is ${email.status}`);
    }
    const [updated] = await db
      .update(emails)
      .set({ status: 'draft', rejectionReason: reason, approvedBy: null, approvedAt: null })
      .where(eq(emails.id, email.id))
      .returning();
    await logActivity(db, {
      organisationId: email.organisationId,
      userId: user.id,
      type: 'email_rejected',
      payload: { emailId: email.id, reason },
    });
    res.json(updated);
  });

  r.post('/emails/:id/cancel', canEdit, async (req, res) => {
    const user = currentUser(req);
    const email = await getEmail(db, idParam(req));
    const allowed =
      user.role === 'admin' ? ['draft', 'pending_approval', 'approved', 'queued', 'failed'] : ['draft'];
    if (!allowed.includes(email.status)) {
      if (user.role !== 'admin')
        throw forbidden('Only an admin can cancel an email that is awaiting approval or later');
      throw badRequest(`Cannot cancel an email that is ${email.status}`);
    }
    const [updated] = await db
      .update(emails)
      .set({ status: 'cancelled' })
      .where(eq(emails.id, email.id))
      .returning();
    await logActivity(db, {
      organisationId: email.organisationId,
      userId: user.id,
      type: 'email_cancelled',
      payload: { emailId: email.id, previousStatus: email.status },
    });
    res.json(updated);
  });

  r.get('/emails-summary', async (_req, res) => {
    const rows = await db.select({ status: emails.status, n: count() }).from(emails).groupBy(emails.status);
    res.json(Object.fromEntries(rows.map((x) => [x.status, Number(x.n)])));
  });

  return r;
}

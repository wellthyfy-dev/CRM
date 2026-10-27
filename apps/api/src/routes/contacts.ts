import { Router } from 'express';
import { and, eq, ne } from 'drizzle-orm';
import { contactCreateSchema, contactUpdateSchema, contactVerifySchema, isHttpUrl } from '@wellthyfy/shared';
import { contacts, isSuppressed, logActivity, QUEUES, suppress, type Db } from '@wellthyfy/shared/server';
import type { RouteDeps } from '../app';
import { canEdit, currentUser } from '../lib/auth';
import { advanceOrg, assertContactEmailFree, cancelUnsentForContact, getContact, getOrg } from '../lib/crm';
import { badRequest } from '../lib/errors';
import { idParam, parseBody } from '../lib/http';

async function clearOtherPrimaries(db: Db, organisationId: string, keepId: string) {
  await db
    .update(contacts)
    .set({ isPrimary: false })
    .where(and(eq(contacts.organisationId, organisationId), ne(contacts.id, keepId)));
}

export function contactRoutes({ db, publisher, now }: RouteDeps): Router {
  const r = Router();

  r.get('/organisations/:id/contacts', async (req, res) => {
    res.json(
      await db
        .select()
        .from(contacts)
        .where(eq(contacts.organisationId, idParam(req))),
    );
  });

  r.post('/organisations/:id/contacts', canEdit, async (req, res) => {
    const user = currentUser(req);
    const org = await getOrg(db, idParam(req));
    const body = parseBody(contactCreateSchema, req);
    await assertContactEmailFree(db, body.email);
    const suppressed = body.email ? await isSuppressed(db, body.email) : false;
    const existing = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.organisationId, org.id));
    const [c] = await db
      .insert(contacts)
      .values({
        organisationId: org.id,
        fullName: body.fullName,
        designation: body.designation,
        email: body.email,
        phone: body.phone,
        sourceUrl: body.sourceUrl,
        isPrimary: body.isPrimary ?? existing.length === 0,
        // An address on the permanent opt-out list stays opted out (safety rule 4).
        optOut: suppressed,
        optOutAt: suppressed ? now() : null,
      })
      .returning();
    if (c!.isPrimary) await clearOtherPrimaries(db, org.id, c!.id);
    await logActivity(db, {
      organisationId: org.id,
      userId: user.id,
      type: 'contact_created',
      payload: { contactId: c!.id, email: c!.email, suppressed },
    });
    if (c!.email) await publisher.send(QUEUES.verifyEmail, { contactId: c!.id });
    res.status(201).json(c);
  });

  r.patch('/contacts/:id', canEdit, async (req, res) => {
    const user = currentUser(req);
    const c = await getContact(db, idParam(req));
    const body = parseBody(contactUpdateSchema, req);
    if (c.anonymisedAt) throw badRequest('This contact was anonymised and cannot be edited');
    const patch: Partial<typeof contacts.$inferInsert> = {};
    if (body.fullName !== undefined) patch.fullName = body.fullName;
    if (body.designation !== undefined) patch.designation = body.designation;
    if (body.phone !== undefined) patch.phone = body.phone;
    const emailChanged = body.email !== undefined && body.email !== c.email;
    const sourceChanged = body.sourceUrl !== undefined && body.sourceUrl !== c.sourceUrl;
    if (emailChanged) {
      await assertContactEmailFree(db, body.email ?? null, c.id);
      patch.email = body.email ?? null;
      patch.emailCheckStatus = 'unknown';
      patch.emailCheckedAt = null;
      if (body.email && (await isSuppressed(db, body.email))) {
        patch.optOut = true;
        patch.optOutAt = now();
      }
    }
    if (body.sourceUrl !== undefined) patch.sourceUrl = body.sourceUrl;
    // Changing the address or its evidence requires re-verification.
    if ((emailChanged || sourceChanged) && c.verified) {
      patch.verified = false;
      patch.verifiedBy = null;
      patch.verifiedAt = null;
    }
    if (body.isPrimary !== undefined) patch.isPrimary = body.isPrimary;
    const [updated] = await db.update(contacts).set(patch).where(eq(contacts.id, c.id)).returning();
    if (updated!.isPrimary) await clearOtherPrimaries(db, c.organisationId, c.id);
    await logActivity(db, {
      organisationId: c.organisationId,
      userId: user.id,
      type: 'contact_updated',
      payload: { contactId: c.id, fields: Object.keys(patch), verificationReset: patch.verified === false },
    });
    if (emailChanged && updated!.email) await publisher.send(QUEUES.verifyEmail, { contactId: c.id });
    res.json(updated);
  });

  r.post('/contacts/:id/verify', canEdit, async (req, res) => {
    const user = currentUser(req);
    const c = await getContact(db, idParam(req));
    const body = parseBody(contactVerifySchema, req);
    const sourceUrl = body.sourceUrl ?? c.sourceUrl;
    if (!isHttpUrl(sourceUrl))
      throw badRequest('A source URL (http:// or https://) is required to verify a contact');
    if (!c.email) throw badRequest('Contact has no email address');
    const [updated] = await db
      .update(contacts)
      .set({ verified: true, verifiedBy: user.id, verifiedAt: now(), sourceUrl })
      .where(eq(contacts.id, c.id))
      .returning();
    await logActivity(db, {
      organisationId: c.organisationId,
      userId: user.id,
      type: 'contact_verified',
      payload: { contactId: c.id, sourceUrl },
    });
    await advanceOrg(db, c.organisationId, 'verified', user.id, 'contact verified');
    res.json(updated);
  });

  r.post('/contacts/:id/unverify', canEdit, async (req, res) => {
    const user = currentUser(req);
    const c = await getContact(db, idParam(req));
    const [updated] = await db
      .update(contacts)
      .set({ verified: false, verifiedBy: null, verifiedAt: null })
      .where(eq(contacts.id, c.id))
      .returning();
    await logActivity(db, {
      organisationId: c.organisationId,
      userId: user.id,
      type: 'contact_unverified',
      payload: { contactId: c.id },
    });
    res.json(updated);
  });

  /** Opt-outs are permanent: there is deliberately no endpoint to undo this. */
  r.post('/contacts/:id/opt-out', canEdit, async (req, res) => {
    const user = currentUser(req);
    const c = await getContact(db, idParam(req));
    const [updated] = await db
      .update(contacts)
      .set({ optOut: true, optOutAt: c.optOutAt ?? now() })
      .where(eq(contacts.id, c.id))
      .returning();
    if (c.email) await suppress(db, c.email, 'manual opt-out');
    const cancelled = await cancelUnsentForContact(db, c.id, 'Contact opted out', user.id);
    await logActivity(db, {
      organisationId: c.organisationId,
      userId: user.id,
      type: 'contact_opted_out',
      payload: { contactId: c.id, source: 'manual', cancelledEmails: cancelled },
    });
    res.json(updated);
  });

  r.post('/contacts/:id/primary', canEdit, async (req, res) => {
    const user = currentUser(req);
    const c = await getContact(db, idParam(req));
    await db.update(contacts).set({ isPrimary: true }).where(eq(contacts.id, c.id));
    await clearOtherPrimaries(db, c.organisationId, c.id);
    await logActivity(db, {
      organisationId: c.organisationId,
      userId: user.id,
      type: 'contact_primary_set',
      payload: { contactId: c.id },
    });
    res.json({ ok: true });
  });

  return r;
}

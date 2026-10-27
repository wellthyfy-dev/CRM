import { and, eq, inArray, ne } from 'drizzle-orm';
import { selectTemplateKey } from '@wellthyfy/shared';
import {
  contacts,
  emails,
  logActivity,
  organisations,
  templates,
  type Contact,
  type Db,
  type Organisation,
  type Template,
} from '@wellthyfy/shared/server';
import { badRequest, conflict, notFound } from './errors';

export async function getOrg(db: Db, id: string): Promise<Organisation> {
  const [org] = await db.select().from(organisations).where(eq(organisations.id, id));
  if (!org) throw notFound('Organisation not found');
  return org;
}

export async function getContact(db: Db, id: string): Promise<Contact> {
  const [c] = await db.select().from(contacts).where(eq(contacts.id, id));
  if (!c) throw notFound('Contact not found');
  return c;
}

export { advanceOrg, setOrgStage } from '@wellthyfy/shared/server';

export async function findOrgByDomain(db: Db, domain: string | null, exceptId?: string) {
  if (!domain) return null;
  const where = exceptId
    ? and(eq(organisations.domain, domain), ne(organisations.id, exceptId))
    : eq(organisations.domain, domain);
  const [row] = await db
    .select({ id: organisations.id, recordId: organisations.recordId, name: organisations.name })
    .from(organisations)
    .where(where);
  return row ?? null;
}

export async function assertDomainFree(db: Db, domain: string | null, exceptId?: string) {
  const existing = await findOrgByDomain(db, domain, exceptId);
  if (existing) {
    throw conflict(
      `An organisation with domain ${domain} already exists (${existing.recordId} ${existing.name})`,
      {
        kind: 'organisation',
        existingId: existing.id,
        recordId: existing.recordId,
        name: existing.name,
      },
    );
  }
}

export async function assertContactEmailFree(db: Db, email: string | null, exceptId?: string) {
  if (!email) return;
  const where = exceptId
    ? and(eq(contacts.email, email), ne(contacts.id, exceptId))
    : eq(contacts.email, email);
  const [row] = await db
    .select({ id: contacts.id, organisationId: contacts.organisationId, orgName: organisations.name })
    .from(contacts)
    .innerJoin(organisations, eq(organisations.id, contacts.organisationId))
    .where(where);
  if (row) {
    throw conflict(`A contact with email ${email} already exists at ${row.orgName}`, {
      kind: 'contact',
      existingId: row.id,
      organisationId: row.organisationId,
      name: row.orgName,
    });
  }
}

export { latestResearch, renderForContact } from '@wellthyfy/shared/server';

export async function resolveTemplate(db: Db, org: Organisation, templateId?: string): Promise<Template> {
  if (templateId) {
    const [t] = await db.select().from(templates).where(eq(templates.id, templateId));
    if (!t) throw notFound('Template not found');
    return t;
  }
  const key = selectTemplateKey(org.segment);
  const [t] = await db.select().from(templates).where(eq(templates.key, key));
  if (!t) throw notFound(`Template ${key} not found — run the seed`);
  return t;
}

/** Statuses where an email has not left the mailbox yet and can still be cancelled. */
export const UNSENT_STATUSES = ['draft', 'pending_approval', 'approved', 'queued'] as const;

/** Cancel every unsent email to a contact (opt-out, bounce, anonymisation). */
export async function cancelUnsentForContact(
  db: Db,
  contactId: string,
  reason: string,
  userId: string | null,
) {
  const rows = await db
    .update(emails)
    .set({ status: 'cancelled', error: reason })
    .where(and(eq(emails.contactId, contactId), inArray(emails.status, [...UNSENT_STATUSES])))
    .returning({ id: emails.id, organisationId: emails.organisationId });
  for (const r of rows) {
    await logActivity(db, {
      organisationId: r.organisationId,
      userId,
      type: 'email_cancelled',
      payload: { emailId: r.id, reason },
    });
  }
  return rows.length;
}

export function requireVerifiedContact(contact: Contact) {
  if (!contact.verified) throw badRequest('Contact must be verified before an email can be created');
  if (!contact.email) throw badRequest('Contact has no email address');
  if (contact.optOut) throw badRequest('Contact has opted out');
}

import { eq } from 'drizzle-orm';
import {
  ensureOptOutLine,
  extractContactDetails,
  pickPrimaryEmail,
  selectContactsToSave,
  selectTemplateKey,
} from '@wellthyfy/shared';
import {
  advanceOrg,
  contacts,
  emails,
  getTemplateByKey,
  isSuppressed,
  logActivity,
  organisations,
  QUEUES,
  renderForContact,
  type Contact,
} from '@wellthyfy/shared/server';
import type { JobDefinition, WorkerDeps } from '../runtime';

/**
 * Discovery "Add" follow-through: read the organisation's official website, save the email addresses and phone
 * numbers that literally appear on it (with the page URL as proof), and put one email to the best contact into
 * Approvals. Contacts from the official site are saved verified on behalf of the user who clicked Add (business
 * decision, see PROGRESS.md); nothing is sent until an admin approves it and the send gate passes.
 */
export async function runDiscoveryContacts(
  deps: WorkerDeps,
  organisationId: string,
  userId: string | null,
): Promise<{ contactIds: string[]; emailId: string | null; error?: string }> {
  const { db, now } = deps;
  const fail = async (error: string) => {
    await logActivity(db, { organisationId, userId, type: 'discovery_contacts_failed', payload: { error } });
    return { contactIds: [], emailId: null, error };
  };
  const [org] = await db.select().from(organisations).where(eq(organisations.id, organisationId));
  if (!org) return { contactIds: [], emailId: null, error: 'Organisation not found' };
  if (!org.website) return fail('Organisation has no website');

  const pages = await deps.fetchPages(org.website);
  if (pages.length === 0) return fail('Could not fetch the website');
  const { emails: allFound, phones } = extractContactDetails(pages);
  const found = selectContactsToSave(allFound, org.domain);
  if (found.length === 0 && phones.length === 0)
    return fail('No email address or phone number on the website');

  const existing = await db.select().from(contacts).where(eq(contacts.organisationId, org.id));
  const primary = pickPrimaryEmail(found, org.orgType, org.domain);
  const saved: Contact[] = [];
  const skipped: { email: string; reason: string }[] = [];
  for (const f of found) {
    // contacts.email is unique across the CRM: an address already on file stays with its organisation.
    const [dupe] = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.email, f.email));
    if (dupe) {
      skipped.push({ email: f.email, reason: 'already a contact' });
      continue;
    }
    const suppressed = await isSuppressed(db, f.email);
    const isPrimary = f === primary && !existing.some((c) => c.isPrimary);
    const [c] = await db
      .insert(contacts)
      .values({
        organisationId: org.id,
        designation: f.designation,
        email: f.email,
        phone: isPrimary ? (phones[0]?.phone ?? null) : null,
        sourceUrl: f.sourceUrl,
        verified: true,
        verifiedBy: userId,
        verifiedAt: now(),
        isPrimary,
        // An address on the permanent opt-out list stays opted out (safety rule 4).
        optOut: suppressed,
        optOutAt: suppressed ? now() : null,
      })
      .returning();
    saved.push(c!);
    await logActivity(db, {
      organisationId: org.id,
      userId,
      type: 'contact_created',
      payload: { contactId: c!.id, email: c!.email, source: 'discovery', sourceUrl: f.sourceUrl, suppressed },
    });
  }
  // A site with phone numbers but no address still gives the team someone to call.
  if (found.length === 0) {
    const [c] = await db
      .insert(contacts)
      .values({
        organisationId: org.id,
        designation: 'Office',
        phone: phones[0]!.phone,
        sourceUrl: phones[0]!.sourceUrl,
        isPrimary: !existing.some((x) => x.isPrimary),
      })
      .returning();
    saved.push(c!);
    await logActivity(db, {
      organisationId: org.id,
      userId,
      type: 'contact_created',
      payload: { contactId: c!.id, phone: c!.phone, source: 'discovery', sourceUrl: c!.sourceUrl },
    });
  }
  if (phones.length > 1) {
    const list = phones.map((p) => `${p.phone} (${p.sourceUrl})`).join('\n');
    await db
      .update(organisations)
      .set({ notes: [org.notes, `Phone numbers on website:\n${list}`].filter(Boolean).join('\n\n') })
      .where(eq(organisations.id, org.id));
  }
  if (saved.some((c) => c.email)) {
    await advanceOrg(db, org.id, 'verified', userId, 'contacts found on official website');
  }

  const target = saved.find((c) => c.email === primary?.email);
  const emailId =
    target && !target.optOut && !org.doNotContact ? await draftFirstEmail(deps, org, target, userId) : null;
  return { contactIds: saved.map((c) => c.id), emailId };
}

async function draftFirstEmail(
  deps: WorkerDeps,
  org: typeof organisations.$inferSelect,
  contact: Contact,
  userId: string | null,
): Promise<string | null> {
  const { db, now } = deps;
  const key = selectTemplateKey(org.segment);
  const template = await getTemplateByKey(db, key);
  if (!template) {
    await logActivity(db, {
      organisationId: org.id,
      userId,
      type: 'discovery_contacts_failed',
      payload: { error: `Template ${key} not found — run the seed` },
    });
    return null;
  }
  const rendered = await renderForContact(db, org, contact, template);
  const [created] = await db
    .insert(emails)
    .values({
      organisationId: org.id,
      contactId: contact.id,
      templateId: template.id,
      templateVersion: template.version,
      kind: 'first_contact',
      followUpNo: 0,
      subject: rendered.subject,
      body: ensureOptOutLine(rendered.body, rendered.optOutLine),
      // Straight to Approvals: an admin still approves every email (safety rule 1).
      status: 'pending_approval',
      createdBy: userId,
      submittedBy: userId,
      submittedAt: now(),
    })
    .returning();
  await db.update(emails).set({ threadId: created!.id }).where(eq(emails.id, created!.id));
  await logActivity(db, {
    organisationId: org.id,
    userId,
    type: 'email_drafted',
    payload: {
      emailId: created!.id,
      subject: created!.subject,
      templateKey: template.key,
      templateVersion: template.version,
      source: 'discovery',
    },
  });
  await logActivity(db, {
    organisationId: org.id,
    userId,
    type: 'email_submitted',
    payload: { emailId: created!.id, subject: created!.subject },
  });
  return created!.id;
}

export const discoveryContactsJob: JobDefinition = {
  queue: QUEUES.discoveryContacts,
  retryLimit: 1,
  async handler(deps, data) {
    const res = await runDiscoveryContacts(
      deps,
      String(data.organisationId ?? ''),
      (data.userId as string) ?? null,
    );
    deps.logger.info(
      {
        organisationId: data.organisationId,
        contacts: res.contactIds.length,
        emailId: res.emailId,
        error: res.error,
      },
      'discovery contacts',
    );
  },
};

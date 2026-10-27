import { eq } from 'drizzle-orm';
import { contacts, logActivity, QUEUES } from '@wellthyfy/shared/server';
import type { JobDefinition } from '../runtime';

/** ZeroBounce verification on contact create/edit (async). "invalid" blocks the send gate. */
export const verifyEmailJob: JobDefinition = {
  queue: QUEUES.verifyEmail,
  retryLimit: 2,
  async handler({ db, verifier, logger, now }, data) {
    const contactId = String(data.contactId ?? '');
    const [c] = await db.select().from(contacts).where(eq(contacts.id, contactId));
    if (!c?.email) return;
    if (!verifier.configured) {
      logger.info({ contactId }, 'ZeroBounce not configured; verification skipped');
      return;
    }
    const status = await verifier.verify(c.email);
    await db
      .update(contacts)
      .set({ emailCheckStatus: status, emailCheckedAt: now() })
      .where(eq(contacts.id, c.id));
    await logActivity(db, {
      organisationId: c.organisationId,
      type: 'email_verified',
      payload: { contactId: c.id, status, provider: 'zerobounce' },
    });
  },
};

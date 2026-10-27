import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contacts, organisations } from '@wellthyfy/shared/server';
import { istWallClockToUtc } from '@wellthyfy/shared';
import { imapDraftJob } from '../src/jobs/imap-draft';
import { verifyEmailJob } from '../src/jobs/verify-email';
import { createHarness, reloadEmail, seedEmail, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness(istWallClockToUtc(2026, 10, 27, 11, 0));
});
afterAll(async () => h.handle.close());

describe('Titan draft job', () => {
  it('builds an RFC 5322 message, appends it to Drafts and stores uid + Message-ID', async () => {
    const { email, org } = await seedEmail(h);
    await imapDraftJob.handler(h.deps, { emailId: email.id });
    const raw = h.mail.drafts.at(-1)!.toString('utf8');
    expect(raw).toMatch(/^From: .*Selvaganapathy V\..*<ceo@wellthyfy\.in>/m);
    expect(raw).toMatch(/^Reply-To: ceo@wellthyfy\.in/m);
    expect(raw).toMatch(/^Message-ID: <[0-9a-f-]+@wellthyfy\.in>/m);
    expect(raw).toContain('text/plain');
    expect(raw).toContain('text/html');
    const e = await reloadEmail(h, email.id);
    expect(e.imapDraftUid).toBe(100);
    expect(raw).toContain(e.messageId!);
    const [o] = await h.handle.db.select().from(organisations).where(eq(organisations.id, org.id));
    expect(o!.stage).toBe('drafted');
  });

  it('keeps the same Message-ID when the draft is rebuilt', async () => {
    const { email } = await seedEmail(h);
    await imapDraftJob.handler(h.deps, { emailId: email.id });
    const first = (await reloadEmail(h, email.id)).messageId;
    await imapDraftJob.handler(h.deps, { emailId: email.id });
    const again = await reloadEmail(h, email.id);
    expect(again.messageId).toBe(first);
    expect(h.mail.deletedDrafts).toContain(101); // the previous draft is replaced
  });

  it('skips emails that are not approved', async () => {
    const { email } = await seedEmail(h, { status: 'draft' });
    const before = h.mail.drafts.length;
    await imapDraftJob.handler(h.deps, { emailId: email.id });
    expect(h.mail.drafts.length).toBe(before);
  });
});

describe('verify-email job', () => {
  it('stores the ZeroBounce result', async () => {
    const { contact } = await seedEmail(h);
    await h.handle.db
      .update(contacts)
      .set({ emailCheckStatus: 'unknown', emailCheckedAt: null })
      .where(eq(contacts.id, contact.id));
    h.deps.verifier = { configured: true, verify: async () => 'invalid' };
    await verifyEmailJob.handler(h.deps, { contactId: contact.id });
    const [c] = await h.handle.db.select().from(contacts).where(eq(contacts.id, contact.id));
    expect(c!.emailCheckStatus).toBe('invalid');
    expect(c!.emailCheckedAt).toBeTruthy();
  });
});

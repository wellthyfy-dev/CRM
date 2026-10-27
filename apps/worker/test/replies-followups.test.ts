import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { istWallClockToUtc } from '@wellthyfy/shared';
import { contacts, emails, organisations, replies, settings, suppressions } from '@wellthyfy/shared/server';
import { createDueFollowUps } from '../src/jobs/follow-ups';
import { pollInbox } from '../src/jobs/imap-poll';
import { createHarness, fakeAi, reloadEmail, seedEmail, type Harness } from './harness';

const SENT_AT = istWallClockToUtc(2026, 10, 20, 11, 0);
let h: Harness;

beforeEach(async () => {
  h = await createHarness(istWallClockToUtc(2026, 10, 27, 11, 0));
});

async function sentEmail() {
  const s = await seedEmail(h, { status: 'sent', sentAt: SENT_AT });
  const messageId = `<root-${s.email.id}@wellthyfy.in>`;
  await h.handle.db.update(emails).set({ messageId }).where(eq(emails.id, s.email.id));
  return { ...s, messageId };
}

let uid = 1;
function inbound(opts: {
  from: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  headers?: string;
}) {
  const raw = [
    `From: ${opts.from}`,
    'To: ceo@wellthyfy.in',
    `Subject: ${opts.subject}`,
    `Message-ID: <in-${uid}-${Math.random().toString(36).slice(2)}@mail.example-sender.in>`,
    'Date: Tue, 27 Oct 2026 06:00:00 +0000',
    opts.inReplyTo ? `In-Reply-To: ${opts.inReplyTo}` : '',
    opts.inReplyTo ? `References: ${opts.inReplyTo}` : '',
    opts.headers ?? '',
    'Content-Type: text/plain; charset=utf-8',
    '',
    opts.body,
  ]
    .filter((l, i, a) => l !== '' || i === a.indexOf(''))
    .join('\r\n');
  h.mail.inbox.push({ uid: uid++, source: Buffer.from(raw) });
}

describe('follow-ups', () => {
  it('drafts follow-up 1 after 7 days as pending approval, threaded as a reply', async () => {
    const { email, messageId } = await sentEmail();
    const { created } = await createDueFollowUps(h.deps);
    expect(created).toHaveLength(1);
    const fu = await reloadEmail(h, created[0]!);
    expect(fu).toMatchObject({
      status: 'pending_approval',
      kind: 'follow_up_1',
      followUpNo: 1,
      parentEmailId: email.id,
      threadId: email.id,
      inReplyTo: messageId,
      references: messageId,
    });
    expect(fu.subject).toBe(`Re: ${email.subject}`);
    expect(fu.approvedBy).toBeNull();
    // Idempotent.
    expect((await createDueFollowUps(h.deps)).created).toHaveLength(0);
  });

  it('is not due before follow_up_1_days', async () => {
    await sentEmail();
    h.clock.now = istWallClockToUtc(2026, 10, 26, 11, 0);
    expect((await createDueFollowUps(h.deps)).created).toHaveLength(0);
  });

  it('drafts follow-up 2 only after follow-up 1 was sent and 14 days passed; never a third', async () => {
    const { email } = await sentEmail();
    const [fu1] = (await createDueFollowUps(h.deps)).created;
    await h.handle.db
      .update(emails)
      .set({ status: 'sent', sentAt: h.clock.now, messageId: '<fu1@wellthyfy.in>' })
      .where(eq(emails.id, fu1!));
    expect((await createDueFollowUps(h.deps)).created).toHaveLength(0);
    h.clock.now = istWallClockToUtc(2026, 11, 3, 11, 0);
    const [fu2] = (await createDueFollowUps(h.deps)).created;
    const e2 = await reloadEmail(h, fu2!);
    expect(e2).toMatchObject({ followUpNo: 2, kind: 'follow_up_2', parentEmailId: fu1, threadId: email.id });
    expect(e2.references).toBe(`<root-${email.id}@wellthyfy.in> <fu1@wellthyfy.in>`);
    await h.handle.db.update(emails).set({ status: 'sent', sentAt: h.clock.now }).where(eq(emails.id, fu2!));
    h.clock.now = istWallClockToUtc(2026, 12, 30, 11, 0);
    expect((await createDueFollowUps(h.deps)).created).toHaveLength(0);
  });

  it('skips opted-out contacts', async () => {
    const { contact } = await sentEmail();
    await h.handle.db.update(contacts).set({ optOut: true }).where(eq(contacts.id, contact.id));
    expect((await createDueFollowUps(h.deps)).created).toHaveLength(0);
  });
});

describe('reply tracking', () => {
  it('matches by In-Reply-To, marks replied, advances the stage and cancels pending follow-ups', async () => {
    const { email, org, contact, messageId } = await sentEmail();
    const [fu] = (await createDueFollowUps(h.deps)).created;
    fakeAi.classifyResult = { classification: 'interested', summary: 'Asked for a proposal' };
    inbound({
      from: `Someone Else <other@gmail.com>`,
      subject: `Re: ${email.subject}`,
      body: 'Please send a proposal.',
      inReplyTo: messageId,
    });
    expect(await pollInbox(h.deps)).toEqual({ processed: 1 });
    const [r] = await h.handle.db.select().from(replies).where(eq(replies.emailId, email.id));
    expect(r).toMatchObject({
      classification: 'interested',
      summary: 'Asked for a proposal',
      contactId: contact.id,
    });
    expect((await reloadEmail(h, email.id)).status).toBe('replied');
    expect((await reloadEmail(h, fu!)).status).toBe('cancelled');
    const [o] = await h.handle.db.select().from(organisations).where(eq(organisations.id, org.id));
    expect(o!.stage).toBe('replied');
    expect(h.publisher.jobs.some((j) => j.queue === 'reply-alert')).toBe(true);
    const [s] = await h.handle.db.select().from(settings);
    expect(s!.imapLastUid).toBe(uid - 1);
  });

  it('falls back to matching the sender to a contact email', async () => {
    const { email, contact } = await sentEmail();
    inbound({ from: contact.email!, subject: 'Hello', body: 'Can we talk next week?' });
    await pollInbox(h.deps);
    const [r] = await h.handle.db.select().from(replies).where(eq(replies.contactId, contact.id));
    expect(r!.emailId).toBe(email.id);
  });

  it('ignores mail unrelated to outreach and never re-reads processed UIDs', async () => {
    inbound({ from: 'newsletter@shop.in', subject: 'Sale', body: 'Buy now' });
    await pollInbox(h.deps);
    expect(await h.handle.db.select().from(replies)).toHaveLength(0);
    expect(await pollInbox(h.deps)).toEqual({ processed: 0 });
  });

  it('STOP reply sets a permanent opt-out without calling AI', async () => {
    const { contact, messageId } = await sentEmail();
    const calls = fakeAi.classifyCalls;
    inbound({ from: contact.email!, subject: 'Re: Training', body: 'STOP', inReplyTo: messageId });
    await pollInbox(h.deps);
    const [c] = await h.handle.db.select().from(contacts).where(eq(contacts.id, contact.id));
    expect(c!.optOut).toBe(true);
    expect(await h.handle.db.select().from(suppressions)).toHaveLength(1);
    expect(fakeAi.classifyCalls).toBe(calls);
    const [r] = await h.handle.db.select().from(replies);
    expect(r!.classification).toBe('unsubscribe');
  });

  it('bounce: email bounced, contact invalid (matched via Message-ID in the DSN body)', async () => {
    const { email, contact, messageId } = await sentEmail();
    inbound({
      from: 'Mail Delivery System <MAILER-DAEMON@titan.email>',
      subject: 'Undelivered Mail Returned to Sender',
      body: `This is the mail system.\n\n<${contact.email}>: host said: 550 User unknown\n\nMessage-ID: ${messageId}`,
    });
    await pollInbox(h.deps);
    expect((await reloadEmail(h, email.id)).status).toBe('bounced');
    const [c] = await h.handle.db.select().from(contacts).where(eq(contacts.id, contact.id));
    expect(c!.emailCheckStatus).toBe('invalid');
  });

  it('out-of-office shifts follow-ups by 7 days and does not count as a reply', async () => {
    const { email, contact, messageId } = await sentEmail();
    inbound({
      from: contact.email!,
      subject: 'Out of Office: Training',
      body: 'I am on leave.',
      inReplyTo: messageId,
    });
    await pollInbox(h.deps);
    const e = await reloadEmail(h, email.id);
    expect(e.status).toBe('sent');
    expect(e.followUpOffsetDays).toBe(7);
    // 7 days after sending is no longer due; 14 days is.
    expect((await createDueFollowUps(h.deps)).created).toHaveLength(0);
    h.clock.now = istWallClockToUtc(2026, 11, 3, 11, 0);
    expect((await createDueFollowUps(h.deps)).created).toHaveLength(1);
  });
});

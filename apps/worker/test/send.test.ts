import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { istWallClockToUtc } from '@wellthyfy/shared';
import { contacts, emails, organisations, settings } from '@wellthyfy/shared/server';
import { sendTick } from '../src/jobs/send';
import { createHarness, reloadEmail, seedEmail, type Harness } from './harness';

// Tuesday 27 Oct 2026 11:00 IST.
const NOW = istWallClockToUtc(2026, 10, 27, 11, 0);
let h: Harness;

beforeEach(async () => {
  h = await createHarness(NOW);
});

async function setSettings(values: Partial<typeof settings.$inferInsert>) {
  await h.handle.db.update(settings).set(values).where(eq(settings.id, 1));
}

describe('send scheduler', () => {
  it('sends one queued email, copies it to Sent, deletes the draft and moves the stage', async () => {
    const { email, org } = await seedEmail(h, { status: 'queued' });
    await h.handle.db.update(emails).set({ imapDraftUid: 77 }).where(eq(emails.id, email.id));
    const r = await sendTick(h.deps);
    expect(r).toEqual({ action: 'sent', emailId: email.id });
    expect(h.mail.sends).toHaveLength(1);
    expect(h.mail.sentCopies).toHaveLength(1);
    expect(h.mail.deletedDrafts).toEqual([77]);
    const e = await reloadEmail(h, email.id);
    expect(e.status).toBe('sent');
    expect(e.sentAt?.toISOString()).toBe(NOW.toISOString());
    expect(h.mail.sends[0]!.raw.toString()).toContain(e.messageId!);
    const [o] = await h.handle.db.select().from(organisations).where(eq(organisations.id, org.id));
    expect(o!.stage).toBe('sent');
    // Random gap is applied before the next send.
    const [s] = await h.handle.db.select().from(settings);
    expect(s!.nextSendAfter?.getTime()).toBe(NOW.getTime() + 90_000);
    expect(h.publisher.jobs.some((j) => j.queue === 'send-tick')).toBe(true);
  });

  it('sends only one at a time and waits for the gap', async () => {
    await seedEmail(h, { status: 'queued' });
    await seedEmail(h, { status: 'queued' });
    expect((await sendTick(h.deps)).action).toBe('sent');
    expect(await sendTick(h.deps)).toMatchObject({
      action: 'idle',
      reason: 'Waiting for the gap between sends',
    });
    h.clock.now = new Date(NOW.getTime() + 91_000);
    expect((await sendTick(h.deps)).action).toBe('sent');
    expect(h.mail.sends).toHaveLength(2);
  });

  it('does nothing outside the send window or on a non-send day (IST)', async () => {
    await seedEmail(h, { status: 'queued' });
    h.clock.now = istWallClockToUtc(2026, 10, 27, 9, 30);
    expect(await sendTick(h.deps)).toMatchObject({ action: 'idle', reason: 'Outside send window' });
    h.clock.now = istWallClockToUtc(2026, 11, 1, 11, 0); // Sunday
    expect(await sendTick(h.deps)).toMatchObject({ action: 'idle', reason: 'Outside send window' });
    expect(h.mail.sends).toHaveLength(0);
  });

  it('respects a cap of 2 (hourly and daily)', async () => {
    await setSettings({ hourlySendCap: 2, dailySendCap: 2 });
    for (let i = 0; i < 3; i++) await seedEmail(h, { status: 'queued' });
    for (let i = 0; i < 3; i++) {
      await setSettings({ nextSendAfter: null });
      await sendTick(h.deps);
    }
    expect(h.mail.sends).toHaveLength(2);
    await setSettings({ nextSendAfter: null });
    const r = await sendTick(h.deps);
    expect(r).toMatchObject({ action: 'waiting' });
    expect((r as { reason: string }).reason).toMatch(/hourly_cap|daily_cap/);
    // Next IST day the third goes out.
    h.clock.now = istWallClockToUtc(2026, 10, 28, 10, 5);
    await setSettings({ nextSendAfter: null });
    expect((await sendTick(h.deps)).action).toBe('sent');
  });

  it('re-runs the gate before SMTP: an opt-out after queueing blocks the send', async () => {
    const { email, contact } = await seedEmail(h, { status: 'queued' });
    await h.handle.db.update(contacts).set({ optOut: true }).where(eq(contacts.id, contact.id));
    const r = await sendTick(h.deps);
    expect(r).toMatchObject({ action: 'blocked' });
    const e = await reloadEmail(h, email.id);
    expect(e.status).toBe('failed');
    expect(e.gateFailureReason).toContain('contact_opted_out');
    expect(h.mail.sends).toHaveLength(0);
  });

  it('never sends an email without a recorded approval', async () => {
    const { email } = await seedEmail(h, { status: 'queued' });
    await h.handle.db.update(emails).set({ approvedBy: null }).where(eq(emails.id, email.id));
    expect((await sendTick(h.deps)).action).toBe('blocked');
    expect(h.mail.sends).toHaveLength(0);
  });

  it('pauses for an hour and retries with backoff on rate limits', async () => {
    const { email } = await seedEmail(h, { status: 'queued' });
    h.mail.sendError = Object.assign(new Error('Too many messages'), { responseCode: 421 });
    expect(await sendTick(h.deps)).toMatchObject({ action: 'error', kind: 'rate_limit' });
    const e = await reloadEmail(h, email.id);
    expect(e).toMatchObject({ status: 'queued', sendAttempts: 1 });
    expect(e.scheduledFor!.getTime()).toBeGreaterThan(NOW.getTime());
    const [s] = await h.handle.db.select().from(settings);
    expect(s!.queuePausedUntil!.getTime()).toBe(NOW.getTime() + 3600_000);
    expect((await sendTick(h.deps)).action).toBe('idle');
  });

  it('marks failed and the contact invalid on a rejected recipient', async () => {
    const { email, contact } = await seedEmail(h, { status: 'queued' });
    h.mail.sendError = Object.assign(new Error('550 5.1.1 User unknown'), { responseCode: 550 });
    expect(await sendTick(h.deps)).toMatchObject({ kind: 'rejected_recipient' });
    expect((await reloadEmail(h, email.id)).status).toBe('failed');
    const [c] = await h.handle.db.select().from(contacts).where(eq(contacts.id, contact.id));
    expect(c!.emailCheckStatus).toBe('invalid');
  });

  it('pauses the queue and alerts staff on authentication errors', async () => {
    const { email } = await seedEmail(h, { status: 'queued' });
    h.mail.sendError = Object.assign(new Error('Invalid login'), { code: 'EAUTH', responseCode: 535 });
    const before = (await import('./harness')).notifications.length;
    expect(await sendTick(h.deps)).toMatchObject({ kind: 'auth' });
    expect((await reloadEmail(h, email.id)).status).toBe('queued');
    const [s] = await h.handle.db.select().from(settings);
    expect(s!.queuePaused).toBe(true);
    expect((await import('./harness')).notifications.length).toBe(before + 1);
  });
});

describe('send hardening', () => {
  it('only one tick can hold the send lease at a time', async () => {
    await seedEmail(h, { status: 'queued' });
    await seedEmail(h, { status: 'queued' });
    const [a, b] = await Promise.all([sendTick(h.deps), sendTick(h.deps)]);
    expect([a.action, b.action].filter((x) => x === 'sent')).toHaveLength(1);
    expect(h.mail.sends).toHaveLength(1);
  });

  it('releases the lease when nothing is sent', async () => {
    expect(await sendTick(h.deps)).toMatchObject({ action: 'idle', reason: 'Nothing queued' });
    const [s] = await h.handle.db.select().from(settings);
    expect(s!.nextSendAfter).toBeNull();
  });

  it('re-appends the opt-out line if it is missing at send time', async () => {
    const { email } = await seedEmail(h, { status: 'queued' });
    await h.handle.db
      .update(emails)
      .set({ body: 'Dear Sir/Madam,\n\nNo footer.' })
      .where(eq(emails.id, email.id));
    await sendTick(h.deps);
    const raw = h.mail.sends[0]!.raw.toString();
    expect(raw).toContain('simply reply STOP.');
    expect((await reloadEmail(h, email.id)).body.endsWith('simply reply STOP.')).toBe(true);
  });
});

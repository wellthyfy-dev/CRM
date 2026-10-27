import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checkSendGate,
  contacts,
  emails,
  organisations,
  profiles,
  settings,
  suppress,
  templates,
  type DbHandle,
} from '../src/server';
import { createTestDb } from '../src/server/testing';
import { istWallClockToUtc } from '../src/time';

const NOW = istWallClockToUtc(2026, 10, 27, 11, 0);
let h: DbHandle;
let adminId: string;

beforeAll(async () => {
  h = await createTestDb();
  adminId = '00000000-0000-4000-8000-000000000001';
  await h.db.insert(profiles).values({ id: adminId, fullName: 'Admin', role: 'admin' });
});
afterAll(async () => h.close());

async function makeEmail(opts: { recordId?: string; contactEmail?: string; verified?: boolean } = {}) {
  const [org] = await h.db
    .insert(organisations)
    .values({
      name: 'Real College',
      orgType: 'college_university',
      segment: 'arts_science',
      ...(opts.recordId ? { recordId: opts.recordId } : {}),
    })
    .returning();
  const [c] = await h.db
    .insert(contacts)
    .values({
      organisationId: org!.id,
      fullName: 'Dr. A',
      email: opts.contactEmail ?? `p${Math.random().toString(36).slice(2)}@realcollege.ac.in`,
      sourceUrl: 'https://realcollege.ac.in/contact',
      verified: opts.verified ?? true,
    })
    .returning();
  const [e] = await h.db
    .insert(emails)
    .values({
      organisationId: org!.id,
      contactId: c!.id,
      subject: 'Hi',
      body: 'Body',
      status: 'approved',
      approvedBy: adminId,
      approvedAt: NOW,
    })
    .returning();
  await h.db.update(emails).set({ threadId: e!.id }).where(eq(emails.id, e!.id));
  return { org: org!, contact: c!, email: e! };
}

describe('database', () => {
  it('seeds settings, templates and programmes', async () => {
    const [s] = await h.db.select().from(settings);
    expect(s).toMatchObject({
      dailySendCap: 30,
      hourlySendCap: 10,
      sendWindowStart: '10:00',
      followUp1Days: 7,
    });
    expect(s!.optOutLine).toBe("If you'd prefer not to receive further emails from us, simply reply STOP.");
    const keys = (await h.db.select({ key: templates.key }).from(templates)).map((t) => t.key).sort();
    expect(keys).toEqual([
      'COLLEGE_GENERAL',
      'COLLEGE_MBA',
      'COMPANY_SALES',
      'COMPANY_STARTUP',
      'FOLLOW_UP_1',
      'FOLLOW_UP_2',
    ]);
  });

  it('auto-generates WF- record ids', async () => {
    const { org } = await makeEmail();
    expect(org.recordId).toMatch(/^WF-\d{6}$/);
  });
});

describe('checkSendGate (DB-backed)', () => {
  it('passes at the queue stage for a valid approved email and clears the reason', async () => {
    const { email } = await makeEmail();
    const r = await checkSendGate(h.db, email.id, { stage: 'queue', now: NOW });
    expect(r.ok).toBe(true);
    const [row] = await h.db.select().from(emails).where(eq(emails.id, email.id));
    expect(row!.gateFailureReason).toBeNull();
  });

  it('stores gate_failure_reason for an unverified contact', async () => {
    const { email } = await makeEmail({ verified: false });
    const r = await checkSendGate(h.db, email.id, { stage: 'queue', now: NOW });
    expect(r.ok).toBe(false);
    const [row] = await h.db.select().from(emails).where(eq(emails.id, email.id));
    expect(row!.gateFailureReason).toContain('contact_not_verified');
  });

  it('blocks SAMPLE- records and suppressed addresses', async () => {
    const a = await makeEmail({ recordId: 'SAMPLE-009' });
    expect(
      (await checkSendGate(h.db, a.email.id, { stage: 'queue', now: NOW })).blocking.map((f) => f.code),
    ).toContain('sample_record');
    const b = await makeEmail({ contactEmail: 'gone@realcollege.ac.in' });
    await suppress(h.db, 'GONE@realcollege.ac.in', 'test');
    expect(
      (await checkSendGate(h.db, b.email.id, { stage: 'queue', now: NOW })).blocking.map((f) => f.code),
    ).toContain('email_suppressed');
  });

  it('counts real sends towards the caps', async () => {
    await h.db.update(settings).set({ dailySendCap: 2, hourlySendCap: 2 });
    const sent1 = await makeEmail();
    const sent2 = await makeEmail();
    for (const s of [sent1, sent2]) {
      // Sent at exactly 11:00 IST, i.e. inside the current IST hour.
      await h.db.update(emails).set({ status: 'sent', sentAt: NOW }).where(eq(emails.id, s.email.id));
    }
    const next = await makeEmail();
    await h.db.update(emails).set({ status: 'queued' }).where(eq(emails.id, next.email.id));
    const r = await checkSendGate(h.db, next.email.id, { stage: 'send', now: NOW });
    expect(r.ok).toBe(false);
    expect(r.blocking.map((f) => f.code)).toEqual(expect.arrayContaining(['hourly_cap', 'daily_cap']));
    await h.db.update(settings).set({ dailySendCap: 30, hourlySendCap: 10 });
  });
});

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contacts, emails, organisations, replies, research } from '@wellthyfy/shared/server';
import { istWallClockToUtc } from '@wellthyfy/shared';
import { createTestContext, type TestContext } from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext({ now: istWallClockToUtc(2026, 10, 27, 11, 0) });
});
afterAll(async () => t.handle.close());

async function approvedEmail() {
  const slug = Math.random().toString(36).slice(2);
  const org = (
    await t
      .as('researcher')
      .post('/api/organisations', {
        name: `C ${slug}`,
        orgType: 'college_university',
        segment: 'mba_commerce',
        website: `https://${slug}.ac.in`,
      })
  ).body;
  const c = (
    await t
      .as('researcher')
      .post(`/api/organisations/${org.id}/contacts`, {
        fullName: 'Dr. X',
        email: `d@${slug}.ac.in`,
        sourceUrl: `https://${slug}.ac.in/x`,
      })
  ).body;
  await t.as('researcher').post(`/api/contacts/${c.id}/verify`, {});
  const e = (await t.as('researcher').post('/api/emails', { organisationId: org.id, contactId: c.id })).body;
  await t.as('admin').post(`/api/emails/${e.id}/approve`);
  return { org, c, e };
}

describe('sending', () => {
  it('only admins can queue; queued emails appear on the queue page', async () => {
    const { e } = await approvedEmail();
    expect((await t.as('researcher').post(`/api/emails/${e.id}/send`)).status).toBe(403);
    const res = await t.as('admin').post(`/api/emails/${e.id}/send`);
    expect(res.status).toBe(200);
    const [row] = await t.handle.db.select().from(emails).where(eq(emails.id, e.id));
    expect(row!.status).toBe('queued');
    expect(t.publisher.jobs.some((j) => j.queue === 'send-tick')).toBe(true);
    const q = await t.as('admin').get('/api/queue');
    expect(q.body.queued.map((x: { id: string }) => x.id)).toContain(e.id);
    expect(q.body).toMatchObject({ dailyCap: 30, hourlyCap: 10, remainingToday: 30, paused: false });
  });

  it('cannot queue an email that is not approved or fails the gate', async () => {
    const { e, c } = await approvedEmail();
    await t.handle.db.update(contacts).set({ emailCheckStatus: 'invalid' }).where(eq(contacts.id, c.id));
    const res = await t.as('admin').post(`/api/emails/${e.id}/send`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid/);
    const [row] = await t.handle.db.select().from(emails).where(eq(emails.id, e.id));
    expect(row!.gateFailureReason).toContain('email_check_invalid');
  });

  it('pause and resume the queue', async () => {
    expect((await t.as('admin').post('/api/queue/pause', { reason: 'Testing' })).body).toMatchObject({
      paused: true,
      pauseReason: 'Testing',
    });
    expect((await t.as('admin').post('/api/queue/resume')).body).toMatchObject({ paused: false });
  });

  it('queues all approved emails in one action', async () => {
    await approvedEmail();
    const res = await t.as('admin').post('/api/emails/send-approved');
    expect(res.body.queued).toBeGreaterThanOrEqual(1);
  });
});

describe('replies', () => {
  it('lists replies with filters and marks them handled', async () => {
    const { org, c, e } = await approvedEmail();
    const [r] = await t.handle.db
      .insert(replies)
      .values({
        emailId: e.id,
        organisationId: org.id,
        contactId: c.id,
        fromEmail: c.email,
        subject: 'Re',
        receivedAt: new Date(),
        classification: 'interested',
        messageId: '<r1@x.in>',
      })
      .returning();
    const list = await t.as('viewer').get('/api/replies?classification=interested&handled=false');
    expect(list.body.items.map((x: { id: string }) => x.id)).toContain(r!.id);
    expect((await t.as('viewer').patch(`/api/replies/${r!.id}`, { handled: true })).status).toBe(403);
    const upd = await t.as('researcher').patch(`/api/replies/${r!.id}`, { handled: true });
    expect(upd.body).toMatchObject({ handled: true });
    expect(upd.body.handledBy).toBeTruthy();
  });
});

describe('AI research', () => {
  it('requires a website and an API key', async () => {
    const org = (
      await t
        .as('researcher')
        .post('/api/organisations', { name: 'No site', orgType: 'company', segment: 'fmcg' })
    ).body;
    expect((await t.as('researcher').post(`/api/organisations/${org.id}/research/ai`)).body.error).toMatch(
      /website/,
    );
    const { org: o2 } = await approvedEmail();
    expect((await t.as('researcher').post(`/api/organisations/${o2.id}/research/ai`)).body.error).toMatch(
      /not configured/,
    );
  });

  it('adds suggested contacts as unverified', async () => {
    const [org] = await t.handle.db.select().from(organisations).limit(1);
    const [row] = await t.handle.db
      .insert(research)
      .values({
        organisationId: org!.id,
        aiGenerated: true,
        aiOutput: {
          candidateContacts: [
            {
              name: 'Dr. AI Found',
              designation: 'Dean',
              email: 'dean@aifound.ac.in',
              sourceUrl: 'https://aifound.ac.in/dean',
              quote: 'x',
            },
          ],
        },
      })
      .returning();
    const res = await t.as('researcher').post(`/api/research/${row!.id}/candidates`, { index: 0 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ verified: false, aiSuggested: true, email: 'dean@aifound.ac.in' });
    expect((await t.as('researcher').post(`/api/research/${row!.id}/candidates`, { index: 0 })).status).toBe(
      409,
    );
  });
});

import request from 'supertest';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activities, contacts, emails, replies, suppressions } from '@wellthyfy/shared/server';
import { createTestContext, type TestContext } from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(async () => t.handle.close());

describe('delete contact data (data-protection request)', () => {
  it('anonymises the contact, redacts emails/replies, scrubs logs and keeps a permanent hashed opt-out', async () => {
    const org = (
      await t
        .as('researcher')
        .post('/api/organisations', {
          name: 'DP College',
          orgType: 'college_university',
          segment: 'arts_science',
          website: 'https://dp.ac.in',
        })
    ).body;
    const c = (
      await t
        .as('researcher')
        .post(`/api/organisations/${org.id}/contacts`, {
          fullName: 'Dr. Private Person',
          email: 'private@dp.ac.in',
          sourceUrl: 'https://dp.ac.in/x',
        })
    ).body;
    await t.as('researcher').post(`/api/contacts/${c.id}/verify`, {});
    const e = (await t.as('researcher').post('/api/emails', { organisationId: org.id, contactId: c.id }))
      .body;
    await t.handle.db
      .insert(replies)
      .values({
        organisationId: org.id,
        contactId: c.id,
        fromEmail: 'private@dp.ac.in',
        snippet: 'Hi, Dr. Private here',
        receivedAt: new Date(),
      });

    expect(
      (await t.as('researcher').post(`/api/contacts/${c.id}/delete-data`, { confirm: 'DELETE' })).status,
    ).toBe(403);
    expect((await t.as('admin').post(`/api/contacts/${c.id}/delete-data`, {})).status).toBe(400);
    expect(
      (await t.as('admin').post(`/api/contacts/${c.id}/delete-data`, { confirm: 'DELETE' })).status,
    ).toBe(200);

    const [after] = await t.handle.db.select().from(contacts).where(eq(contacts.id, c.id));
    expect(after).toMatchObject({
      fullName: 'Deleted contact',
      email: null,
      sourceUrl: null,
      optOut: true,
      verified: false,
    });
    expect(after!.anonymisedAt).toBeTruthy();
    const [mail] = await t.handle.db.select().from(emails).where(eq(emails.id, e.id));
    expect(mail!.status).toBe('cancelled');
    expect(mail!.body).not.toContain('Private');
    const [rep] = await t.handle.db.select().from(replies).where(eq(replies.contactId, c.id));
    expect(rep).toMatchObject({ fromEmail: '[deleted]', snippet: null });
    const logs = await t.handle.db.select().from(activities).where(eq(activities.organisationId, org.id));
    expect(JSON.stringify(logs)).not.toContain('private@dp.ac.in');
    expect(logs.some((a) => a.type === 'contact_data_deleted')).toBe(true);
    expect((await t.handle.db.select().from(suppressions)).length).toBeGreaterThan(0);

    // Re-adding the same address later stays opted out.
    const again = (
      await t
        .as('researcher')
        .post(`/api/organisations/${org.id}/contacts`, { fullName: 'X', email: 'private@dp.ac.in' })
    ).body;
    expect(again.optOut).toBe(true);
  });

  it('sets security headers', async () => {
    const res = await request(t.app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });
});

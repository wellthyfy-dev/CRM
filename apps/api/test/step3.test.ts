import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { discoveryRuns, emails, organisations, programmes } from '@wellthyfy/shared/server';
import { createTestContext, type TestContext } from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(async () => t.handle.close());

async function orgWithVerifiedContact() {
  const slug = Math.random().toString(36).slice(2);
  const org = (
    await t
      .as('researcher')
      .post('/api/organisations', {
        name: `Acme ${slug}`,
        orgType: 'company',
        segment: 'fmcg',
        website: `https://${slug}.co.in`,
      })
  ).body;
  const c = (
    await t
      .as('researcher')
      .post(`/api/organisations/${org.id}/contacts`, {
        fullName: 'Ms. L&D Head',
        designation: 'L&D Head',
        email: `ld@${slug}.co.in`,
        sourceUrl: `https://${slug}.co.in/team`,
      })
  ).body;
  await t.as('researcher').post(`/api/contacts/${c.id}/verify`, {});
  return { org, c };
}

describe('proposals', () => {
  it('creates a branded PDF, attaches it to a draft email (approval still required) and accepting confirms training', async () => {
    const { org, c } = await orgWithVerifiedContact();
    const [programme] = await t.handle.db.select().from(programmes).limit(1);
    const res = await t.as('researcher').post('/api/proposals', {
      organisationId: org.id,
      programmeId: programme!.id,
      contactId: c.id,
      duration: 'Two-day workshop',
      valueInr: 120000,
      notes: 'Includes pre-training needs survey.',
    });
    expect(res.status).toBe(201);
    expect(res.body.filePath).toBe(`proposals/${org.id}/${res.body.id}.pdf`);
    const pdf = t.services.files.files.get(res.body.filePath)!;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

    const dl = await t.as('viewer').get(`/api/proposals/${res.body.id}/pdf`).buffer(true);
    expect(dl.headers['content-type']).toBe('application/pdf');

    const mail = await t.as('researcher').post(`/api/proposals/${res.body.id}/email`, {});
    expect(mail.status).toBe(201);
    expect(mail.body).toMatchObject({ kind: 'proposal', status: 'draft' });
    expect(mail.body.attachments[0]).toMatchObject({
      path: res.body.filePath,
      contentType: 'application/pdf',
    });
    expect(mail.body.body).toContain('Please find attached our proposal');
    expect(mail.body.body.endsWith('simply reply STOP.')).toBe(true);
    const [e] = await t.handle.db.select().from(emails).where(eq(emails.id, mail.body.id));
    expect(e!.approvedBy).toBeNull();

    const acc = await t.as('researcher').post(`/api/proposals/${res.body.id}/status`, { status: 'accepted' });
    expect(acc.body.status).toBe('accepted');
    const [o] = await t.handle.db.select().from(organisations).where(eq(organisations.id, org.id));
    expect(o!.stage).toBe('training_confirmed');
  });

  it('viewers cannot create proposals', async () => {
    expect((await t.as('viewer').post('/api/proposals', {})).status).toBe(403);
  });
});

describe('discovery', () => {
  it('requires Serper to start a run; "add selected" creates research_needed organisations', async () => {
    expect(
      (
        await t
          .as('researcher')
          .post('/api/discovery', {
            orgType: 'company',
            segment: 'pharma',
            state: 'Tamil Nadu',
            maxResults: 5,
          })
      ).body.error,
    ).toMatch(/not configured/);
    const [run] = await t.handle.db
      .insert(discoveryRuns)
      .values({
        query: 'x',
        params: {
          orgType: 'company',
          segment: 'pharma',
          state: 'Tamil Nadu',
          city: 'Chennai',
          maxResults: 5,
        },
        status: 'done',
        results: [
          {
            name: 'Medi Pharma Ltd',
            website: 'https://medipharma.in/',
            domain: 'medipharma.in',
            snippet: 'Pharma maker',
            query: 'q',
          },
        ],
      })
      .returning();
    const res = await t
      .as('researcher')
      .post(`/api/discovery/${run!.id}/add`, { domains: ['medipharma.in'] });
    expect(res.body.created).toHaveLength(1);
    const [o] = await t.handle.db
      .select()
      .from(organisations)
      .where(eq(organisations.domain, 'medipharma.in'));
    expect(o).toMatchObject({
      stage: 'research_needed',
      source: 'discovery',
      segment: 'pharma',
      city: 'Chennai',
    });
    const again = await t
      .as('researcher')
      .post(`/api/discovery/${run!.id}/add`, { domains: ['medipharma.in'] });
    expect(again.body.skipped[0].reason).toBe('already exists');
  });
});

describe('reports', () => {
  it('returns report sections and CSV exports', async () => {
    const r = await t.as('viewer').get('/api/reports');
    expect(r.body.overall.total).toBeGreaterThan(0);
    expect(Array.isArray(r.body.bySegment)).toBe(true);
    for (const section of ['segment', 'city', 'template', 'month', 'stages']) {
      const csv = await t.as('viewer').get(`/api/reports/export.csv?section=${section}`);
      expect(csv.status).toBe(200);
      expect(csv.headers['content-type']).toContain('text/csv');
    }
  });
});

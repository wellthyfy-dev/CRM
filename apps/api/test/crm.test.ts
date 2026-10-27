import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  activities,
  contacts,
  emails,
  organisations,
  suppressions,
  templateVersions,
} from '@wellthyfy/shared/server';
import { createTestContext, type TestContext } from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const REFERENCE_XLSX = path.resolve(here, '../../../reference/Wellthyfy_Outreach_CRM.xlsx');

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(async () => t.handle.close());

async function createOrg(
  name = 'PSG College of Arts & Science',
  website = `https://www.${Math.random().toString(36).slice(2)}.ac.in`,
) {
  const res = await t.as('researcher').post('/api/organisations', {
    name,
    orgType: 'college_university',
    segment: 'arts_science',
    city: 'Coimbatore',
    state: 'Tamil Nadu',
    website,
  });
  expect(res.status).toBe(201);
  return res.body as { id: string; recordId: string; domain: string };
}

async function createContact(
  orgId: string,
  email = `principal.${Math.random().toString(36).slice(2)}@psgcas.ac.in`,
) {
  const res = await t.as('researcher').post(`/api/organisations/${orgId}/contacts`, {
    fullName: 'Dr. T. Kannaiyan',
    designation: 'Principal',
    email,
    sourceUrl: 'https://psgcas.ac.in/principal',
  });
  expect(res.status).toBe(201);
  return res.body as { id: string; email: string; isPrimary: boolean };
}

describe('organisations', () => {
  it('auto-assigns WF- record ids and normalises the domain', async () => {
    const org = await createOrg('Test College', 'https://WWW.TestCollege.edu.in/about');
    expect(org.recordId).toMatch(/^WF-\d{6}$/);
    expect(org.domain).toBe('testcollege.edu.in');
  });

  it('blocks duplicate domains with a link to the existing record', async () => {
    const org = await createOrg('Dup College', 'https://dupcollege.ac.in');
    const res = await t.as('researcher').post('/api/organisations', {
      name: 'Dup College again',
      orgType: 'college_university',
      segment: 'arts_science',
      website: 'http://www.dupcollege.ac.in/contact',
    });
    expect(res.status).toBe(409);
    expect(res.body.details).toMatchObject({
      kind: 'organisation',
      existingId: org.id,
      recordId: org.recordId,
    });
  });

  it('viewers are read-only', async () => {
    const res = await t
      .as('viewer')
      .post('/api/organisations', { name: 'X', orgType: 'company', segment: 'fmcg' });
    expect(res.status).toBe(403);
    expect((await t.as('viewer').get('/api/organisations')).status).toBe(200);
  });

  it('searches by contact email and filters by verified', async () => {
    const org = await createOrg('Searchable Institute');
    await createContact(org.id, 'unique.search@searchable.ac.in');
    const res = await t.as('viewer').get('/api/organisations?q=unique.search');
    expect(res.body.items.map((o: { id: string }) => o.id)).toEqual([org.id]);
    const unverified = await t.as('viewer').get('/api/organisations?verified=false&q=Searchable');
    expect(unverified.body.total).toBe(1);
  });

  it('requires a reason to mark lost and logs stage changes', async () => {
    const org = await createOrg('Lost College');
    expect(
      (await t.as('researcher').post(`/api/organisations/${org.id}/stage`, { stage: 'lost' })).status,
    ).toBe(400);
    const ok = await t
      .as('researcher')
      .post(`/api/organisations/${org.id}/stage`, { stage: 'lost', lostReason: 'No budget' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ stage: 'lost', lostReason: 'No budget' });
    const acts = await t.handle.db.select().from(activities).where(eq(activities.organisationId, org.id));
    expect(acts.some((a) => a.type === 'stage_changed')).toBe(true);
  });

  it('exports CSV', async () => {
    const res = await t.as('viewer').get('/api/organisations/export.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('Record ID');
  });
});

describe('contacts', () => {
  it('blocks duplicate contact emails', async () => {
    const org = await createOrg();
    await createContact(org.id, 'same@college.ac.in');
    const other = await createOrg();
    const res = await t
      .as('researcher')
      .post(`/api/organisations/${other.id}/contacts`, { fullName: 'X', email: 'SAME@college.ac.in' });
    expect(res.status).toBe(409);
    expect(res.body.details).toMatchObject({ kind: 'contact', organisationId: org.id });
  });

  it('verification requires an http(s) source URL and records who/when', async () => {
    const org = await createOrg();
    const res0 = await t.as('researcher').post(`/api/organisations/${org.id}/contacts`, {
      fullName: 'No Source',
      email: 'nosource@college.ac.in',
    });
    expect((await t.as('researcher').post(`/api/contacts/${res0.body.id}/verify`, {})).status).toBe(400);
    const c = await createContact(org.id);
    const v = await t.as('researcher').post(`/api/contacts/${c.id}/verify`, {});
    expect(v.status).toBe(200);
    expect(v.body.verified).toBe(true);
    expect(v.body.verifiedBy).toBeTruthy();
    expect(v.body.verifiedAt).toBeTruthy();
    // Editing the email resets verification.
    const e = await t.as('researcher').patch(`/api/contacts/${c.id}`, { email: 'changed@psgcas.ac.in' });
    expect(e.body.verified).toBe(false);
  });

  it('opt-out is permanent, suppresses the address and cancels unsent emails', async () => {
    const org = await createOrg();
    const c = await createContact(org.id, 'optout@college.ac.in');
    await t.as('researcher').post(`/api/contacts/${c.id}/verify`, {});
    const draft = await t.as('researcher').post('/api/emails', { organisationId: org.id, contactId: c.id });
    expect(draft.status).toBe(201);
    const res = await t.as('researcher').post(`/api/contacts/${c.id}/opt-out`, {});
    expect(res.body.optOut).toBe(true);
    const [e] = await t.handle.db.select().from(emails).where(eq(emails.id, draft.body.id));
    expect(e!.status).toBe('cancelled');
    expect((await t.handle.db.select().from(suppressions)).length).toBeGreaterThan(0);
    // Re-adding the same address elsewhere keeps it opted out.
    await t.handle.db.delete(contacts).where(eq(contacts.id, c.id));
    const other = await createOrg();
    const again = await t
      .as('researcher')
      .post(`/api/organisations/${other.id}/contacts`, { fullName: 'Again', email: 'optout@college.ac.in' });
    expect(again.body.optOut).toBe(true);
  });
});

describe('drafting and approval', () => {
  async function verifiedSetup() {
    const org = await createOrg('Approval College');
    const c = await createContact(org.id);
    await t.as('researcher').post(`/api/contacts/${c.id}/verify`, {});
    return { org, c };
  }

  it('cannot create an email for an unverified contact', async () => {
    const org = await createOrg();
    const c = await createContact(org.id);
    const res = await t.as('researcher').post('/api/emails', { organisationId: org.id, contactId: c.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/verified/);
  });

  it('auto-selects the template by segment, renders it and appends the opt-out line', async () => {
    const { org, c } = await verifiedSetup();
    const render = await t
      .as('researcher')
      .post('/api/emails/render', { organisationId: org.id, contactId: c.id });
    expect(render.body.templateKey).toBe('COLLEGE_GENERAL');
    expect(render.body.body).toContain('Dear Dr. T. Kannaiyan Sir/Madam,');
    expect(render.body.body.endsWith('simply reply STOP.')).toBe(true);
  });

  it('researcher drafts + submits; only admin approves; approval is recorded', async () => {
    const { org, c } = await verifiedSetup();
    const draft = await t.as('researcher').post('/api/emails', { organisationId: org.id, contactId: c.id });
    expect(draft.body.status).toBe('draft');
    const sub = await t.as('researcher').post(`/api/emails/${draft.body.id}/submit`);
    expect(sub.body.status).toBe('pending_approval');
    expect((await t.as('researcher').post(`/api/emails/${draft.body.id}/approve`)).status).toBe(403);
    expect((await t.as('viewer').post(`/api/emails/${draft.body.id}/approve`)).status).toBe(403);
    const appr = await t.as('admin').post(`/api/emails/${draft.body.id}/approve`);
    expect(appr.status).toBe(200);
    expect(appr.body.email).toMatchObject({ status: 'approved' });
    expect(appr.body.email.approvedBy).toBeTruthy();
    expect(appr.body.email.approvedAt).toBeTruthy();
    expect(t.publisher.jobs.some((j) => j.queue === 'imap-draft' && j.data.emailId === draft.body.id)).toBe(
      true,
    );
    const [o] = await t.handle.db.select().from(organisations).where(eq(organisations.id, org.id));
    expect(o!.stage).toBe('approved');
  });

  it('approval is blocked by the gate for opted-out contacts and do-not-contact orgs', async () => {
    const { org, c } = await verifiedSetup();
    const draft = await t.as('researcher').post('/api/emails', { organisationId: org.id, contactId: c.id });
    await t.as('researcher').post(`/api/emails/${draft.body.id}/submit`);
    await t.handle.db.update(organisations).set({ doNotContact: true }).where(eq(organisations.id, org.id));
    const res = await t.as('admin').post(`/api/emails/${draft.body.id}/approve`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/do-not-contact/);
  });

  it('reject returns the email to draft with a reason; researcher can no longer edit pending emails', async () => {
    const { org, c } = await verifiedSetup();
    const draft = await t.as('researcher').post('/api/emails', { organisationId: org.id, contactId: c.id });
    await t.as('researcher').post(`/api/emails/${draft.body.id}/submit`);
    expect((await t.as('researcher').patch(`/api/emails/${draft.body.id}`, { subject: 'x' })).status).toBe(
      400,
    );
    expect((await t.as('admin').post(`/api/emails/${draft.body.id}/reject`, {})).status).toBe(400);
    const rej = await t.as('admin').post(`/api/emails/${draft.body.id}/reject`, { reason: 'Too long' });
    expect(rej.body).toMatchObject({ status: 'draft', rejectionReason: 'Too long' });
    const edited = await t.as('researcher').patch(`/api/emails/${draft.body.id}`, { body: 'Short body.' });
    expect(edited.body.body).toMatch(/Short body\.\n\nIf you'd prefer not to receive/);
  });

  it('bulk approve reports each email individually', async () => {
    const a = await verifiedSetup();
    const b = await verifiedSetup();
    const e1 = await t.as('researcher').post('/api/emails', { organisationId: a.org.id, contactId: a.c.id });
    const e2 = await t.as('researcher').post('/api/emails', { organisationId: b.org.id, contactId: b.c.id });
    await t.as('researcher').post(`/api/emails/${e1.body.id}/submit`);
    await t.as('researcher').post(`/api/emails/${e2.body.id}/submit`);
    await t.handle.db.update(contacts).set({ verified: false }).where(eq(contacts.id, b.c.id));
    const res = await t.as('admin').post('/api/emails/bulk-approve', { ids: [e1.body.id, e2.body.id] });
    expect(res.body.approved).toBe(1);
    expect(res.body.results[1]).toMatchObject({ ok: false });
  });

  it('approval queue lists pending emails with contact, source and research', async () => {
    const { org, c } = await verifiedSetup();
    await t.as('researcher').put(`/api/organisations/${org.id}/research`, {
      trainingNeed: 'Placement readiness',
      sourceUrls: ['https://psgcas.ac.in/placement'],
    });
    const draft = await t.as('researcher').post('/api/emails', { organisationId: org.id, contactId: c.id });
    await t.as('researcher').post(`/api/emails/${draft.body.id}/submit`);
    const res = await t.as('admin').get('/api/approvals');
    const item = res.body.find((x: { email: { id: string } }) => x.email.id === draft.body.id);
    expect(item.contact.sourceUrl).toBe('https://psgcas.ac.in/principal');
    expect(item.research.trainingNeed).toBe('Placement readiness');
    expect(item.warnings).toContain('Email has not been verified with ZeroBounce yet');
    expect((await t.as('researcher').get('/api/approvals')).status).toBe(403);
  });
});

describe('templates', () => {
  it('editing creates a new version and keeps history', async () => {
    const list = await t.as('viewer').get('/api/templates');
    const tpl = list.body.find((x: { key: string }) => x.key === 'COMPANY_SALES');
    expect((await t.as('researcher').patch(`/api/templates/${tpl.id}`, { subject: 'x' })).status).toBe(403);
    const res = await t
      .as('admin')
      .patch(`/api/templates/${tpl.id}`, { subject: 'New subject | {{organisationName}}' });
    expect(res.body.version).toBe(tpl.version + 1);
    const versions = await t.handle.db
      .select()
      .from(templateVersions)
      .where(eq(templateVersions.templateId, tpl.id));
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2]);
    const bad = await t.as('admin').patch(`/api/templates/${tpl.id}`, { body: 'Hi {{unknownField}}' });
    expect(bad.status).toBe(400);
  });

  it('previews against an organisation and contact', async () => {
    const org = await createOrg('Preview College');
    const c = await createContact(org.id);
    const res = await t.as('researcher').post('/api/templates/preview', {
      subject: 'Hello {{organisationName}}',
      body: 'Dear {{contactName}}\n\n{{signature}}',
      organisationId: org.id,
      contactId: c.id,
    });
    expect(res.body.subject).toBe('Hello Preview College');
    expect(res.body.body).toContain('Dr. T. Kannaiyan');
  });
});

describe('import', () => {
  it('parses the reference workbook with the 26 columns pre-mapped and skips SAMPLE rows', async () => {
    const parsed = await t.as('researcher').post('/api/import/parse').attach('file', REFERENCE_XLSX);
    expect(parsed.status).toBe(200);
    expect(parsed.body.sheetName).toBe('Organisations');
    expect(parsed.body.headers).toHaveLength(26);
    expect(Object.keys(parsed.body.suggestedMapping)).toHaveLength(26);
    const commit = await t.as('researcher').post('/api/import/commit', {
      rows: parsed.body.rows,
      mapping: parsed.body.suggestedMapping,
    });
    expect(commit.body).toMatchObject({ created: 0, skipped: 2 });
    expect(commit.body.results[0].reason).toMatch(/SAMPLE/);
  });

  it('imports real rows: type, segment guess, verified, opt-out, approval, stage and follow-up', async () => {
    const mapping = {
      recordId: 'Record ID',
      name: 'Organisation Name',
      orgType: 'Organisation Type',
      industryDepartment: 'Industry / Department',
      city: 'City',
      state: 'State',
      website: 'Official Website',
      contactName: 'Contact Person',
      designation: 'Designation',
      email: 'Official Email',
      sourceUrl: 'Contact Source URL',
      contactVerified: 'Contact Verified (YES/NO)',
      approvalStatus: 'Approval Status',
      outreachStatus: 'Outreach Status',
      followUpDate: 'Follow-up Date',
      optOut: 'Opt-out? (YES/NO)',
      emailSubject: 'Email Subject',
    };
    const rows = [
      {
        'Record ID': 'TN-1',
        'Organisation Name': 'Madras Christian College MBA',
        'Organisation Type': 'College / University',
        'Industry / Department': 'MBA / Management',
        City: 'Chennai',
        State: 'Tamil Nadu',
        'Official Website': 'mcc.edu.in',
        'Contact Person': 'Dr. Placement',
        Designation: 'Placement Head',
        'Official Email': 'placement@mcc.edu.in',
        'Contact Source URL': 'https://mcc.edu.in/placement',
        'Contact Verified (YES/NO)': 'YES',
        'Approval Status': 'APPROVED FOR DRAFT',
        'Outreach Status': 'Research Needed',
        'Follow-up Date': '15/11/2026',
        'Opt-out? (YES/NO)': 'NO',
        'Email Subject': 'Training for [Organisation Name]',
      },
      {
        'Organisation Name': 'Acme Pharma Ltd',
        'Organisation Type': 'Company',
        'Industry / Department': 'Pharma',
        'Official Website': 'https://acmepharma.co.in',
        'Official Email': 'ld@acmepharma.co.in',
        'Approval Status': 'DO NOT CONTACT',
        'Opt-out? (YES/NO)': 'YES',
      },
      { 'Organisation Name': 'Bad Type', 'Organisation Type': 'Alien' },
    ];
    const res = await t.as('researcher').post('/api/import/commit', { rows, mapping });
    expect(res.body).toMatchObject({ created: 2, skipped: 1 });
    const [mcc] = await t.handle.db
      .select()
      .from(organisations)
      .where(eq(organisations.domain, 'mcc.edu.in'));
    expect(mcc).toMatchObject({
      orgType: 'college_university',
      segment: 'mba_commerce',
      stage: 'approved',
      source: 'import',
    });
    expect(mcc!.nextFollowUpAt?.toISOString()).toBe('2026-11-14T18:30:00.000Z');
    const [mccContact] = await t.handle.db
      .select()
      .from(contacts)
      .where(eq(contacts.organisationId, mcc!.id));
    expect(mccContact).toMatchObject({ verified: true, optOut: false, isPrimary: true });
    const mccEmails = await t.handle.db.select().from(emails).where(eq(emails.organisationId, mcc!.id));
    expect(mccEmails[0]).toMatchObject({
      status: 'draft',
      subject: 'Training for Madras Christian College MBA',
    });
    const [acme] = await t.handle.db
      .select()
      .from(organisations)
      .where(eq(organisations.domain, 'acmepharma.co.in'));
    expect(acme).toMatchObject({ segment: 'pharma', doNotContact: true });
    const [acmeContact] = await t.handle.db
      .select()
      .from(contacts)
      .where(eq(contacts.organisationId, acme!.id));
    expect(acmeContact!.optOut).toBe(true);
    // Re-import updates instead of duplicating.
    const again = await t.as('researcher').post('/api/import/commit', { rows: rows.slice(0, 1), mapping });
    expect(again.body).toMatchObject({ created: 0, updated: 1 });
  });

  it('viewers cannot import', async () => {
    expect((await t.as('viewer').post('/api/import/commit', { rows: [{}], mapping: {} })).status).toBe(403);
  });
});

describe('pipeline, dashboard, users, settings', () => {
  it('returns pipeline columns and dashboard totals', async () => {
    const p = await t.as('viewer').get('/api/pipeline');
    expect(p.body.columns).toHaveLength(11);
    const d = await t.as('viewer').get('/api/dashboard');
    expect(d.body.totals.organisations).toBeGreaterThan(0);
    expect(d.body.funnel).toHaveLength(11);
  });

  it('admin invites users and cannot demote the last admin', async () => {
    const res = await t
      .as('admin')
      .post('/api/users/invite', { email: 'new@wellthyfy.in', fullName: 'New Person', role: 'researcher' });
    expect(res.status).toBe(201);
    expect(t.services.invited[0]).toMatchObject({ email: 'new@wellthyfy.in' });
    expect(
      (
        await t
          .as('researcher')
          .post('/api/users/invite', { email: 'x@wellthyfy.in', fullName: 'X', role: 'admin' })
      ).status,
    ).toBe(403);
    const me = await t.as('admin').get('/api/me');
    expect((await t.as('admin').patch(`/api/users/${me.body.user.id}`, { role: 'viewer' })).status).toBe(400);
  });

  it('settings: anyone reads (no secrets), only admin updates; Titan test returns pass/fail only', async () => {
    const s = await t.as('viewer').get('/api/settings');
    expect(s.body.settings.dailySendCap).toBe(30);
    expect(JSON.stringify(s.body)).not.toMatch(/password|api_key|service_role/i);
    expect((await t.as('researcher').patch('/api/settings', { dailySendCap: 5 })).status).toBe(403);
    const u = await t.as('admin').patch('/api/settings', { dailySendCap: 2, hourlySendCap: 2 });
    expect(u.body).toMatchObject({ dailySendCap: 2, hourlySendCap: 2 });
    const bad = await t
      .as('admin')
      .patch('/api/settings', { sendWindowStart: '18:00', sendWindowEnd: '09:00' });
    expect(bad.status).toBe(400);
    const tt = await t.as('admin').post('/api/settings/test-titan');
    expect(tt.body).toEqual({ imap: 'fail', smtp: 'fail' });
  });
});

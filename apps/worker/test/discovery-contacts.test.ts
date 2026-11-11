import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  activities,
  checkSendGate,
  contacts,
  emails,
  organisations,
  suppress,
} from '@wellthyfy/shared/server';
import { runDiscoveryContacts } from '../src/jobs/discovery-contacts';
import { ADMIN_ID, createHarness, pages, type Harness } from './harness';

let h: Harness;
let orgId: string;

beforeEach(async () => {
  h = await createHarness(new Date('2026-10-27T05:30:00Z'));
  const [org] = await h.handle.db
    .insert(organisations)
    .values({
      name: 'Kumaraguru College',
      orgType: 'college_university',
      segment: 'engineering',
      website: 'https://kct.ac.in',
      domain: 'kct.ac.in',
      source: 'discovery',
    })
    .returning();
  orgId = org!.id;
  pages.value = [
    { url: 'https://kct.ac.in/', title: 'KCT', text: 'Admissions: info@kct.ac.in | 0422-2661100' },
    {
      url: 'https://kct.ac.in/contact',
      title: 'Contact',
      text: 'Principal: principal [at] kct [dot] ac [dot] in\nPlacement: placement@kct.ac.in, +91 98765 43210',
    },
  ];
});

describe('discovery contact finder', () => {
  it('saves website contacts as verified with their page and puts one email to the principal in Approvals', async () => {
    const r = await runDiscoveryContacts(h.deps, orgId, ADMIN_ID);
    expect(r.error).toBeUndefined();
    const saved = await h.handle.db.select().from(contacts).where(eq(contacts.organisationId, orgId));
    expect(saved.map((c) => [c.email, c.designation, c.sourceUrl, c.verified, c.isPrimary])).toEqual([
      ['info@kct.ac.in', 'Office', 'https://kct.ac.in/', true, false],
      ['principal@kct.ac.in', 'Principal', 'https://kct.ac.in/contact', true, true],
      ['placement@kct.ac.in', 'Placement / Training Officer', 'https://kct.ac.in/contact', true, false],
    ]);
    const principal = saved.find((c) => c.isPrimary)!;
    expect(principal.phone).toBe('+91 4222661100');
    expect(principal.verifiedBy).toBe(ADMIN_ID);

    const [email] = await h.handle.db.select().from(emails).where(eq(emails.organisationId, orgId));
    expect(email).toMatchObject({
      id: r.emailId,
      contactId: principal.id,
      status: 'pending_approval',
      kind: 'first_contact',
      threadId: r.emailId,
      submittedBy: ADMIN_ID,
    });
    expect(email!.body).toContain('Dear Sir/Madam,');
    expect(email!.body).toMatch(/opt|unsubscribe|STOP/i);
    // Approval is still required: the send gate refuses it until an admin approves.
    const gate = await checkSendGate(h.handle.db, email!.id, {
      stage: 'queue',
      now: h.deps.now(),
      record: false,
    });
    expect(gate.ok).toBe(false);
    // Approval is the only thing missing: verified contact + source URL already satisfy the gate.
    expect(gate.blocking.map((f) => f.code).sort()).toEqual(['approval_not_recorded', 'not_approved']);

    const [org] = await h.handle.db.select().from(organisations).where(eq(organisations.id, orgId));
    expect(org!.stage).toBe('verified');
    expect(org!.notes).toContain('+91 9876543210 (https://kct.ac.in/contact)');
  });

  it('keeps opted-out addresses opted out and does not email them', async () => {
    await suppress(h.handle.db, 'principal@kct.ac.in', 'unsubscribe');
    const r = await runDiscoveryContacts(h.deps, orgId, ADMIN_ID);
    const [principal] = await h.handle.db
      .select()
      .from(contacts)
      .where(eq(contacts.email, 'principal@kct.ac.in'));
    expect(principal!.optOut).toBe(true);
    expect(r.emailId).toBeNull();
    expect(await h.handle.db.select().from(emails)).toHaveLength(0);
  });

  it('records why nothing was found', async () => {
    pages.value = [{ url: 'https://kct.ac.in/', title: 'KCT', text: 'Welcome to our campus.' }];
    const r = await runDiscoveryContacts(h.deps, orgId, ADMIN_ID);
    expect(r).toMatchObject({ contactIds: [], emailId: null });
    const log = await h.handle.db.select().from(activities).where(eq(activities.organisationId, orgId));
    expect(log.map((a) => a.type)).toEqual(['discovery_contacts_failed']);
  });
});

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { discoveryRuns, emails, organisations, proposals, settings } from '@wellthyfy/shared/server';
import { istWallClockToUtc } from '@wellthyfy/shared';
import { runDiscovery } from '../src/jobs/discovery';
import { sendTick } from '../src/jobs/send';
import { createHarness, fakeSearcher, reloadEmail, seedEmail, type Harness } from './harness';

let h: Harness;
beforeEach(async () => {
  h = await createHarness(istWallClockToUtc(2026, 10, 27, 11, 0));
  fakeSearcher.calls = [];
});

async function newRun(maxResults = 5) {
  const [run] = await h.handle.db
    .insert(discoveryRuns)
    .values({
      query: 'test',
      params: {
        orgType: 'college_university',
        segment: 'engineering',
        state: 'Tamil Nadu',
        city: 'Coimbatore',
        maxResults,
      },
      status: 'pending',
    })
    .returning();
  return run!;
}

describe('discovery job', () => {
  it('searches, filters out social/directories/existing orgs and stores candidates', async () => {
    await h.handle.db.insert(organisations).values({
      name: 'Existing',
      orgType: 'college_university',
      segment: 'engineering',
      domain: 'existing.ac.in',
    });
    fakeSearcher.results = [
      { title: 'KCT – Home', link: 'https://kct.ac.in/' },
      { title: 'Existing College', link: 'https://www.existing.ac.in/' },
      { title: 'Shiksha list', link: 'https://www.shiksha.com/x' },
    ];
    const run = await newRun();
    await runDiscovery(h.deps, run.id);
    const [after] = await h.handle.db.select().from(discoveryRuns).where(eq(discoveryRuns.id, run.id));
    expect(after!.status).toBe('done');
    expect(after!.results.map((r) => r.domain)).toEqual(['kct.ac.in']);
    expect(after!.searchesUsed).toBeGreaterThan(0);
    expect(fakeSearcher.calls[0]).toBe('engineering college in Coimbatore Tamil Nadu');
  });

  it('enforces the monthly search limit', async () => {
    await h.handle.db.update(settings).set({ searchMonthlyLimit: 1 });
    fakeSearcher.results = [];
    const run = await newRun();
    await runDiscovery(h.deps, run.id);
    const [after] = await h.handle.db.select().from(discoveryRuns).where(eq(discoveryRuns.id, run.id));
    expect(after!.searchesUsed).toBe(1);
    expect(after!.error).toBe('Monthly search limit reached');
  });
});

describe('proposal email send', () => {
  it('attaches the PDF, marks the proposal sent and moves the stage to proposal_sent', async () => {
    const { email, org } = await seedEmail(h, { status: 'queued' });
    await h.handle.db
      .update(emails)
      .set({
        kind: 'proposal',
        attachments: [{ path: 'proposals/x.pdf', filename: 'Proposal.pdf', contentType: 'application/pdf' }],
      })
      .where(eq(emails.id, email.id));
    await h.handle.db
      .update(organisations)
      .set({ stage: 'meeting_scheduled' })
      .where(eq(organisations.id, org.id));
    const [p] = await h.handle.db
      .insert(proposals)
      .values({ organisationId: org.id, emailId: email.id, status: 'draft' })
      .returning();
    expect((await sendTick(h.deps)).action).toBe('sent');
    const raw = h.mail.sends[0]!.raw.toString();
    expect(raw).toContain('application/pdf');
    expect(raw).toContain('Proposal.pdf');
    expect((await reloadEmail(h, email.id)).status).toBe('sent');
    const [p2] = await h.handle.db.select().from(proposals).where(eq(proposals.id, p!.id));
    expect(p2!.status).toBe('sent');
    const [o] = await h.handle.db.select().from(organisations).where(eq(organisations.id, org.id));
    expect(o!.stage).toBe('proposal_sent');
  });
});

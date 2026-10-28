import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { aiUsage, organisations, research, settings } from '@wellthyfy/shared/server';
import { runAiResearch } from '../src/jobs/ai-research';
import { createHarness, fakeAi, pages, type Harness } from './harness';

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
    })
    .returning();
  orgId = org!.id;
  pages.value = [
    {
      url: 'https://kct.ac.in/',
      title: 'KCT',
      text: 'Kumaraguru College of Technology. Placement training for 3000 students.',
    },
    {
      url: 'https://kct.ac.in/placement',
      title: 'Placement',
      text: 'Dr. A. Ravi, Head – Placement. Email: placement@kct.ac.in',
    },
  ];
  fakeAi.researchResult = {
    model: 'gemini-3.5-flash-lite',
    tokensIn: 12000,
    tokensOut: 1500,
    output: {
      trainingNeed: 'Interview readiness for final-year students',
      websiteEvidence: [
        { quote: 'Placement training for 3000 students.', url: 'https://kct.ac.in/' },
        { quote: 'made up', url: 'https://not-fetched.in/x' },
      ],
      recommendedProgrammeName: 'SAMPLE – edit me: Campus to Career – Employability & Communication Skills',
      durationFormat: 'Half-day workshop',
      personalisationNote: 'Large placement programme',
      candidateContacts: [
        {
          name: 'Dr. A. Ravi',
          designation: 'Head – Placement',
          email: 'placement@kct.ac.in',
          sourceUrl: 'https://kct.ac.in/placement',
          quote: 'Dr. A. Ravi, Head – Placement',
        },
        {
          name: 'Dr. Invented Person',
          designation: 'Principal',
          email: 'principal@kct.ac.in',
          sourceUrl: 'https://kct.ac.in/placement',
          quote: '',
        },
      ],
      draftSubject: 'Interview readiness training for KCT',
      draftBody: 'Dear Sir/Madam,\n\nBody.\n\n{{signature}}',
      confidence: 'medium',
    },
  };
});

describe('AI research', () => {
  it('saves research, drops contacts not verbatim on the page, and records cost at ₹88/$', async () => {
    const r = await runAiResearch(h.deps, orgId, null);
    expect(r.researchId).toBeTruthy();
    const [row] = await h.handle.db.select().from(research).where(eq(research.id, r.researchId!));
    expect(row).toMatchObject({
      aiGenerated: true,
      aiModel: 'gemini-3.5-flash-lite',
      tokensIn: 12000,
      tokensOut: 1500,
    });
    expect(row!.recommendedProgrammeId).toBeTruthy();
    const out = row!.aiOutput as {
      candidateContacts: { name: string }[];
      droppedContacts: number;
      websiteEvidence: unknown[];
    };
    expect(out.candidateContacts.map((c) => c.name)).toEqual(['Dr. A. Ravi']);
    expect(out.droppedContacts).toBe(1);
    expect(out.websiteEvidence).toHaveLength(1);
    // (12000 × 0.30 + 1500 × 2.50) / 1e6 USD × 88
    expect(row!.costInr).toBeCloseTo(0.6468, 4);
    expect(await h.handle.db.select().from(aiUsage)).toHaveLength(1);
  });

  it('enforces the monthly AI limit', async () => {
    await h.handle.db.update(settings).set({ aiMonthlyLimitInr: 0.1 });
    await runAiResearch(h.deps, orgId, null);
    const second = await runAiResearch(h.deps, orgId, null);
    expect(second).toEqual({ researchId: null, error: 'Monthly AI limit reached' });
  });

  it('fails cleanly without a website', async () => {
    await h.handle.db.update(organisations).set({ website: null }).where(eq(organisations.id, orgId));
    expect((await runAiResearch(h.deps, orgId, null)).error).toBe('Organisation has no website');
  });
});

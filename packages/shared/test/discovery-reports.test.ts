import { describe, expect, it } from 'vitest';
import {
  buildDiscoveryQueries,
  filterSearchResults,
  isExcludedDomain,
  nameFromTitle,
} from '../src/discovery';
import { computeReports, type ReportInput } from '../src/reports';

describe('discovery filtering', () => {
  it('drops social media, directories, news, job boards and existing organisations', () => {
    const results = [
      { title: 'PSG College of Arts & Science | Coimbatore', link: 'https://www.psgcas.ac.in/about' },
      { title: 'PSG on Facebook', link: 'https://facebook.com/psg' },
      { title: 'Top colleges - Shiksha', link: 'https://www.shiksha.com/colleges' },
      { title: 'News', link: 'https://timesofindia.indiatimes.com/x' },
      { title: 'Jobs', link: 'https://www.naukri.com/x' },
      { title: 'Existing', link: 'https://existing.ac.in/' },
      { title: 'PSG again', link: 'https://psgcas.ac.in/contact' },
      { title: 'Kumaraguru College of Technology – Home', link: 'https://kct.ac.in/' },
    ];
    const out = filterSearchResults(results, 'q', new Set(['existing.ac.in']));
    expect(out.map((c) => c.domain)).toEqual(['psgcas.ac.in', 'kct.ac.in']);
    expect(out[0]).toMatchObject({
      name: 'PSG College of Arts & Science',
      website: 'https://www.psgcas.ac.in/',
    });
    expect(out[1]!.name).toBe('Kumaraguru College of Technology');
  });

  it('flags excluded domains and subdomains', () => {
    expect(isExcludedDomain('in.linkedin.com')).toBe(true);
    expect(isExcludedDomain('jobs.acme.com')).toBe(true);
    expect(isExcludedDomain('acmefoods.co.in')).toBe(false);
  });

  it('builds queries for the chosen segment and location', () => {
    const qs = buildDiscoveryQueries({
      orgType: 'company',
      segment: 'pharma',
      state: 'Tamil Nadu',
      city: 'Chennai',
    });
    expect(qs[0]).toBe('pharmaceutical company in Chennai Tamil Nadu');
    expect(qs).toHaveLength(3);
    expect(nameFromTitle('Welcome to ABC Foods - Official Website')).toBe('ABC Foods');
  });
});

describe('reports', () => {
  const d = (s: string) => new Date(s);
  const input: ReportInput = {
    organisations: [
      {
        id: 'a',
        segment: 'fmcg',
        orgType: 'company',
        city: 'Chennai',
        district: null,
        stage: 'training_confirmed',
        createdAt: d('2026-09-01T00:00:00Z'),
      },
      {
        id: 'b',
        segment: 'fmcg',
        orgType: 'company',
        city: 'Chennai',
        district: null,
        stage: 'lost',
        createdAt: d('2026-09-05T00:00:00Z'),
      },
      {
        id: 'c',
        segment: 'arts_science',
        orgType: 'college_university',
        city: 'Madurai',
        district: null,
        stage: 'research_needed',
        createdAt: d('2026-10-01T00:00:00Z'),
      },
    ],
    stageChanges: [
      { organisationId: 'a', from: 'research_needed', to: 'sent', at: d('2026-09-11T00:00:00Z') },
      { organisationId: 'a', from: 'sent', to: 'replied', at: d('2026-09-15T00:00:00Z') },
      { organisationId: 'a', from: 'replied', to: 'meeting_scheduled', at: d('2026-09-20T00:00:00Z') },
      { organisationId: 'a', from: 'meeting_scheduled', to: 'proposal_sent', at: d('2026-09-25T00:00:00Z') },
      { organisationId: 'a', from: 'proposal_sent', to: 'training_confirmed', at: d('2026-10-05T00:00:00Z') },
      { organisationId: 'b', from: 'research_needed', to: 'sent', at: d('2026-09-15T00:00:00Z') },
      { organisationId: 'b', from: 'sent', to: 'lost', at: d('2026-10-15T00:00:00Z') },
    ],
    emails: [
      {
        id: 'e1',
        organisationId: 'a',
        templateKey: 'COMPANY_SALES',
        kind: 'first_contact',
        status: 'replied',
        sentAt: d('2026-09-11T05:00:00Z'),
        threadId: 'e1',
      },
      {
        id: 'e2',
        organisationId: 'b',
        templateKey: 'COMPANY_SALES',
        kind: 'first_contact',
        status: 'sent',
        sentAt: d('2026-09-15T05:00:00Z'),
        threadId: 'e2',
      },
    ],
    replies: [
      {
        emailId: 'e1',
        organisationId: 'a',
        classification: 'interested',
        receivedAt: d('2026-09-15T05:00:00Z'),
      },
      {
        emailId: 'e2',
        organisationId: 'b',
        classification: 'out_of_office',
        receivedAt: d('2026-09-16T05:00:00Z'),
      },
    ],
    proposals: [
      {
        organisationId: 'a',
        status: 'accepted',
        valueInr: 100000,
        createdAt: d('2026-09-24T00:00:00Z'),
        sentAt: d('2026-09-25T00:00:00Z'),
        decidedAt: d('2026-10-05T00:00:00Z'),
      },
      {
        organisationId: 'b',
        status: 'sent',
        valueInr: 50000,
        createdAt: d('2026-10-01T00:00:00Z'),
        sentAt: d('2026-10-02T00:00:00Z'),
        decidedAt: null,
      },
    ],
  };
  const r = computeReports(input);

  it('counts the funnel from stage history (lost orgs keep the stages they reached)', () => {
    expect(r.overall).toMatchObject({
      total: 3,
      sent: 2,
      replied: 1,
      meetings: 1,
      proposals: 1,
      confirmed: 1,
      replyRate: 50,
      winRate: 100,
    });
    expect(r.overall.pipelineValueInr).toBe(50000);
    expect(r.overall.confirmedValueInr).toBe(100000);
    expect(r.bySegment.find((x) => x.key === 'fmcg')).toMatchObject({ total: 2, sent: 2 });
  });

  it('computes template reply rates ignoring out-of-office replies', () => {
    expect(r.byTemplate).toEqual([{ key: 'COMPANY_SALES', sent: 2, replied: 1, replyRate: 50 }]);
  });

  it('groups by IST month and averages days per stage', () => {
    expect(r.byMonth.map((m) => m.month)).toEqual(['2026-09', '2026-10']);
    expect(r.byMonth[1]).toMatchObject({ confirmed: 1, confirmedValueInr: 100000, pipelineValueInr: 50000 });
    const sent = r.avgDaysPerStage.find((s) => s.stage === 'sent')!;
    expect(sent).toMatchObject({ samples: 2, avgDays: 17 }); // (4 + 30) / 2
  });
});

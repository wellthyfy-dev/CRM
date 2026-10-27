import { describe, expect, it } from 'vitest';
import {
  guessSegment,
  mapOrgType,
  parseImportDate,
  REFERENCE_COLUMNS,
  suggestMapping,
  transformRow,
} from '../src/import/mapping';
import { advancedStage } from '../src/stages';

const HEADERS = Object.keys(REFERENCE_COLUMNS);

describe('import mapping', () => {
  it('pre-fills all 26 reference columns', () => {
    expect(HEADERS).toHaveLength(26);
    const m = suggestMapping(HEADERS);
    expect(Object.keys(m)).toHaveLength(26);
    expect(m.name).toBe('Organisation Name');
    expect(m.optOut).toBe('Opt-out? (YES/NO)');
  });

  it('maps loose headers by alias', () => {
    expect(suggestMapping(['Company', 'Type', 'Email', 'Website'])).toMatchObject({
      name: 'Company',
      orgType: 'Type',
      email: 'Email',
      website: 'Website',
    });
  });

  it('maps organisation types and guesses segments', () => {
    expect(mapOrgType('College / University')).toBe('college_university');
    expect(mapOrgType('Company')).toBe('company');
    expect(mapOrgType('???')).toBeNull();
    expect(
      guessSegment('college_university', 'Placement & Training', 'Sample Government Arts & Science College'),
    ).toBe('arts_science');
    expect(guessSegment('college_university', 'MBA')).toBe('mba_commerce');
    expect(guessSegment('college_university', 'Dept of Mechanical', 'PSG College of Technology')).toBe(
      'engineering',
    );
    expect(guessSegment('company', 'FMCG / Sales Training')).toBe('fmcg');
    expect(guessSegment('company', 'Consumer Health OTC')).toBe('otc');
    expect(guessSegment('company', 'Pharma')).toBe('pharma');
    expect(guessSegment('company', 'B2B SaaS')).toBe('startup_b2b');
    expect(guessSegment('company', 'Textiles')).toBe('other_company');
  });

  it('parses Indian dates as IST', () => {
    expect(parseImportDate('15/11/2026')?.toISOString()).toBe('2026-11-14T18:30:00.000Z');
    expect(parseImportDate('2026-11-15')?.toISOString()).toBe('2026-11-14T18:30:00.000Z');
    expect(parseImportDate('')).toBeNull();
    expect(parseImportDate('nonsense')).toBeNull();
  });

  const mapping = suggestMapping(HEADERS);
  const row = (over: Record<string, unknown>) => ({
    'Organisation Name': 'Real College',
    'Organisation Type': 'College / University',
    ...over,
  });

  it('skips SAMPLE- rows, missing names and unknown types', () => {
    expect(transformRow(row({ 'Record ID': 'SAMPLE-001' }), mapping, 2).skip).toMatch(/SAMPLE/);
    expect(transformRow(row({ 'Organisation Name': '' }), mapping, 2).skip).toMatch(/name/);
    expect(transformRow(row({ 'Organisation Type': 'Alien' }), mapping, 2).skip).toMatch(/type/);
  });

  it('only imports verified when the source URL is http(s)', () => {
    const t = transformRow(
      row({
        'Official Email': 'p@real.ac.in',
        'Contact Verified (YES/NO)': 'YES',
        'Contact Source URL': 'real.ac.in',
      }),
      mapping,
      2,
    );
    expect(t.contact?.verified).toBe(false);
    expect(t.warnings.join()).toMatch(/source URL/);
  });

  it('maps outreach status, approval status and opt-out', () => {
    expect(transformRow(row({ 'Outreach Status': 'Meeting Scheduled' }), mapping, 2).organisation.stage).toBe(
      'meeting_scheduled',
    );
    expect(transformRow(row({ 'Outreach Status': 'No Response' }), mapping, 2).organisation.stage).toBe(
      'sent',
    );
    expect(
      transformRow(row({ 'Approval Status': 'APPROVED FOR DRAFT' }), mapping, 2).organisation.stage,
    ).toBe('approved');
    expect(
      transformRow(row({ 'Approval Status': 'DO NOT CONTACT' }), mapping, 2).organisation.doNotContact,
    ).toBe(true);
    const opted = transformRow(
      row({ 'Outreach Status': 'Opted Out', 'Official Email': 'x@real.ac.in' }),
      mapping,
      2,
    );
    expect(opted.organisation).toMatchObject({ stage: 'lost', lostReason: 'Opted out' });
    expect(opted.contact?.optOut).toBe(true);
  });
});

describe('advancedStage', () => {
  it('only moves forward and never out of lost/on_hold', () => {
    expect(advancedStage('research_needed', 'sent')).toBe('sent');
    expect(advancedStage('replied', 'sent')).toBeNull();
    expect(advancedStage('lost', 'replied')).toBeNull();
    expect(advancedStage('on_hold', 'sent')).toBeNull();
  });
});

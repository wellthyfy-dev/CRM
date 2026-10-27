import { describe, expect, it } from 'vitest';
import {
  buildMergeVars,
  convertLegacyPlaceholders,
  ensureOptOutLine,
  renderEmail,
  renderTemplate,
  replySubject,
  selectTemplateKey,
  unknownMergeFields,
} from '../src/templates/render';
import { SEED_TEMPLATES } from '../src/templates/seed-data';
import { DEFAULT_OPT_OUT_LINE, DEFAULT_SIGNATURE, SEGMENTS } from '../src/constants';

describe('renderTemplate', () => {
  it('replaces variables and drops unknown ones', () => {
    expect(
      renderTemplate('Hi {{contactName}} at {{organisationName}}{{nope}}', {
        contactName: 'Dr. Rao',
        organisationName: 'ABC',
      }),
    ).toBe('Hi Dr. Rao at ABC');
  });
  it('renders conditional and inverted sections', () => {
    const t =
      'Dear {{#contactName}}{{contactName}} {{/contactName}}Sir/Madam,{{^trainingNeed}} (general){{/trainingNeed}}';
    expect(renderTemplate(t, { contactName: 'Priya' })).toBe('Dear Priya Sir/Madam, (general)');
    expect(renderTemplate(t, { contactName: '', trainingNeed: 'x' })).toBe('Dear Sir/Madam,');
  });
  it('collapses blank lines left by empty sections', () => {
    expect(renderTemplate('a\n\n{{#x}}X\n\n{{/x}}b', {})).toBe('a\n\nb');
  });
});

describe('seed templates', () => {
  it('only use known merge fields and end with the opt-out line', () => {
    for (const t of SEED_TEMPLATES) {
      expect(unknownMergeFields(t.subject + t.body)).toEqual([]);
      const r = renderEmail(t, {
        contactName: 'Dr. Meena',
        organisationName: 'Real College',
        signature: DEFAULT_SIGNATURE,
        optOutLine: DEFAULT_OPT_OUT_LINE,
      });
      expect(r.body.endsWith(DEFAULT_OPT_OUT_LINE)).toBe(true);
      expect(r.body).toContain('Dear Dr. Meena Sir/Madam,');
      expect(r.body).not.toMatch(/\{\{|\}\}/);
    }
  });
  it('COMPANY_SALES subject includes the organisation', () => {
    const t = SEED_TEMPLATES.find((x) => x.key === 'COMPANY_SALES')!;
    expect(renderEmail(t, { organisationName: 'Acme FMCG', optOutLine: 'STOP' }).subject).toBe(
      'Customised Sales Training Proposal | Acme FMCG',
    );
  });
  it('includes training need, duration and personalisation when present', () => {
    const t = SEED_TEMPLATES.find((x) => x.key === 'COLLEGE_GENERAL')!;
    const vars = buildMergeVars({
      organisation: { name: 'X College' },
      contact: { fullName: '', designation: 'Principal' },
      research: {
        trainingNeed: 'placement readiness',
        durationFormat: 'Half-day',
        personalisationNote: 'New MBA block opened',
      },
      programme: { name: 'Campus to Career' },
      settings: { signature: 'SIG', optOutLine: 'OPT' },
    });
    const r = renderEmail(t, vars);
    expect(r.body).toContain('Dear Sir/Madam,');
    expect(r.body).toContain('placement readiness');
    expect(r.body).toContain('(Half-day)');
    expect(r.body).toContain('New MBA block opened');
    expect(r.body).toContain('"Campus to Career"');
  });
});

describe('selectTemplateKey (ported from the .gs logic)', () => {
  it('maps every segment', () => {
    const map = Object.fromEntries(SEGMENTS.map((s) => [s, selectTemplateKey(s)]));
    expect(map).toEqual({
      arts_science: 'COLLEGE_GENERAL',
      engineering: 'COLLEGE_GENERAL',
      mba_commerce: 'COLLEGE_MBA',
      other_college: 'COLLEGE_GENERAL',
      fmcg: 'COMPANY_SALES',
      otc: 'COMPANY_SALES',
      pharma: 'COMPANY_SALES',
      startup_b2b: 'COMPANY_STARTUP',
      other_company: 'COMPANY_STARTUP',
    });
  });
});

describe('helpers', () => {
  it('ensureOptOutLine appends once', () => {
    expect(ensureOptOutLine('Body', 'STOP line')).toBe('Body\n\nSTOP line');
    expect(ensureOptOutLine('Body\n\nSTOP line', 'STOP line')).toBe('Body\n\nSTOP line');
  });
  it('replySubject prefixes once', () => {
    expect(replySubject('Hello')).toBe('Re: Hello');
    expect(replySubject('RE: Hello')).toBe('RE: Hello');
  });
  it('converts legacy placeholders', () => {
    expect(convertLegacyPlaceholders('[Contact Name] / [Organisation Name] / [Company Name]')).toBe(
      '{{contactName}} / {{organisationName}} / {{organisationName}}',
    );
  });
});

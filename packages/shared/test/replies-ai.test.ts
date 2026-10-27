import { describe, expect, it } from 'vitest';
import { classifyByRules, extractMessageIds, replySnippet, stripQuoted } from '../src/replies/classify';
import { aiCostInr, filterVerbatimContacts, type AiCandidateContact } from '../src/ai/research';
import { extractLinks, htmlToText, pickRelevantLinks } from '../src/server/crawl';

const base = {
  fromAddress: 'principal@college.ac.in',
  subject: 'Re: Training Proposal',
  text: '',
  headers: {},
};

describe('reply classification rules', () => {
  it('detects bounces from mailer-daemon, subject or DSN content type', () => {
    expect(classifyByRules({ ...base, fromAddress: 'MAILER-DAEMON@titan.email' })).toBe('bounce');
    expect(classifyByRules({ ...base, fromAddress: 'postmaster@college.ac.in' })).toBe('bounce');
    expect(classifyByRules({ ...base, subject: 'Delivery Status Notification (Failure)' })).toBe('bounce');
    expect(classifyByRules({ ...base, subject: 'Undeliverable: Training' })).toBe('bounce');
    expect(classifyByRules({ ...base, contentType: 'multipart/report; report-type=delivery-status' })).toBe(
      'bounce',
    );
  });

  it('detects unsubscribe requests', () => {
    expect(classifyByRules({ ...base, text: 'STOP' })).toBe('unsubscribe');
    expect(classifyByRules({ ...base, text: 'Please unsubscribe me.' })).toBe('unsubscribe');
    expect(classifyByRules({ ...base, text: 'Kindly remove me from your list' })).toBe('unsubscribe');
    expect(classifyByRules({ ...base, subject: 'STOP', text: '' })).toBe('unsubscribe');
  });

  it('detects "not interested"', () => {
    expect(classifyByRules({ ...base, text: 'Thanks, but we are not interested at this time.' })).toBe(
      'not_interested',
    );
  });

  it('ignores the STOP line in quoted history', () => {
    const text = `Yes, please send the proposal.\n\nOn Mon, 2 Nov 2026 at 10:00, Selva <ceo@wellthyfy.in> wrote:\n> If you'd prefer not to receive further emails from us, simply reply STOP.`;
    expect(classifyByRules({ ...base, text })).toBeNull();
    expect(stripQuoted(text)).toBe('Yes, please send the proposal.');
  });

  it('detects out-of-office', () => {
    expect(classifyByRules({ ...base, subject: 'Out of Office: Training Proposal' })).toBe('out_of_office');
    expect(classifyByRules({ ...base, subject: 'Automatic reply: Training' })).toBe('out_of_office');
    expect(classifyByRules({ ...base, headers: { 'auto-submitted': 'auto-replied' } })).toBe('out_of_office');
    expect(classifyByRules({ ...base, text: 'I am currently on leave until 10 Nov.' })).toBe('out_of_office');
  });

  it('leaves normal replies for AI', () => {
    expect(
      classifyByRules({ ...base, text: 'Could you share your fees for a half-day workshop?' }),
    ).toBeNull();
  });

  it('extracts message ids and snippets', () => {
    expect(
      extractMessageIds('Original-Message-ID: <abc-123@wellthyfy.in>\nx <abc-123@wellthyfy.in>'),
    ).toEqual(['<abc-123@wellthyfy.in>']);
    expect(replySnippet('Hello   there\n\n> quoted')).toBe('Hello there');
  });
});

describe('AI contact verbatim filter (safety rule 3)', () => {
  const pages = [
    {
      url: 'https://college.ac.in/placement',
      text: 'Placement Cell\nDr. S. Meena, Placement Officer\nEmail: placement@college.ac.in',
    },
    { url: 'https://college.ac.in/about', text: 'About us. Founded 1965.' },
  ];
  const c = (over: Partial<AiCandidateContact>): AiCandidateContact => ({
    name: 'Dr. S. Meena',
    designation: 'Placement Officer',
    email: 'placement@college.ac.in',
    sourceUrl: 'https://college.ac.in/placement',
    quote: 'Dr. S. Meena, Placement Officer',
    ...over,
  });

  it('keeps contacts that appear verbatim on the cited page', () => {
    const r = filterVerbatimContacts(
      [c({}), c({ name: 'dr. s.  meena', email: 'PLACEMENT@college.ac.in' })],
      pages,
    );
    expect(r.kept).toHaveLength(2);
    expect(r.dropped).toHaveLength(0);
  });

  it('drops invented names, invented emails and wrong source pages', () => {
    const r = filterVerbatimContacts(
      [
        c({ name: 'Dr. R. Kumar' }),
        c({ email: 'meena@college.ac.in' }),
        c({ sourceUrl: 'https://college.ac.in/about' }),
        c({ sourceUrl: 'https://other.example/placement' }),
        c({ name: '', email: '' }),
      ],
      pages,
    );
    expect(r.kept).toHaveLength(0);
    expect(r.dropped.map((d) => d.reason)).toEqual([
      'name not found verbatim on page',
      'email not found verbatim on page',
      'name not found verbatim on page',
      'sourceUrl is not one of the fetched pages',
      'no name or email',
    ]);
  });

  it('blanks a designation that is not on the page', () => {
    const r = filterVerbatimContacts([c({ designation: 'Principal' })], pages);
    expect(r.kept[0]!.designation).toBe('');
  });
});

describe('AI cost', () => {
  it('prices Haiku and Sonnet at ₹88/$', () => {
    // 1M in + 1M out on Haiku 5.5 = $0.60 = ₹52.80
    expect(aiCostInr('claude-haiku-5-5', 1_000_000, 1_000_000, 88)).toBeCloseTo(52.8);
    // 10k in + 2k out on Sonnet 5.5 = $0.04 = ₹3.52
    expect(aiCostInr('claude-sonnet-5-5', 10_000, 2_000, 88)).toBeCloseTo(3.52);
  });
});

describe('crawler helpers', () => {
  it('strips html to text and keeps mailto addresses', () => {
    const { title, text } = htmlToText(
      '<html><head><title>PSG College</title><style>.x{}</style></head><body><script>x()</script><p>Principal &amp; Dean</p><a href="mailto:principal@psg.ac.in">Email us</a></body></html>',
    );
    expect(title).toBe('PSG College');
    expect(text).toContain('Principal & Dean');
    expect(text).toContain('principal@psg.ac.in');
    expect(text).not.toContain('x()');
  });

  it('picks relevant same-domain links', () => {
    const html =
      '<a href="/about-us">About</a><a href="https://www.psg.ac.in/placement/cell">Placement</a><a href="https://facebook.com/psg">FB</a><a href="/brochure.pdf">PDF</a><a href="/gallery">Gallery</a>';
    const links = extractLinks(html, 'https://www.psg.ac.in/');
    expect(pickRelevantLinks(links, 'psg.ac.in')).toEqual([
      'https://www.psg.ac.in/about-us',
      'https://www.psg.ac.in/placement/cell',
    ]);
  });
});

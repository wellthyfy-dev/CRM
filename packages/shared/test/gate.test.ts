import { describe, expect, it } from 'vitest';
import { evaluateSendGate, type GateContext, type GateFailureCode } from '../src/gate/evaluate';
import { istWallClockToUtc } from '../src/time';

// Tuesday 27 Oct 2026, 11:00 IST — inside the default window (10:00–17:00, Mon–Sat).
const NOW = istWallClockToUtc(2026, 10, 27, 11, 0);

function baseCtx(overrides: Partial<GateContext> = {}): GateContext {
  return {
    stage: 'send',
    now: NOW,
    email: {
      id: 'e1',
      status: 'queued',
      approvedBy: 'u-admin',
      approvedAt: new Date(NOW.getTime() - 3600_000),
      followUpNo: 0,
      parentEmailId: null,
      threadId: 'e1',
    },
    contact: {
      email: 'principal@realcollege.edu.in',
      verified: true,
      sourceUrl: 'https://realcollege.edu.in/contact',
      optOut: false,
      emailCheckStatus: 'valid',
    },
    organisation: { recordId: 'WF-000001', doNotContact: false },
    suppressed: false,
    recentSendsToContact: [],
    sendsThisHour: 0,
    sendsToday: 0,
    settings: {
      hourlySendCap: 10,
      dailySendCap: 30,
      sendWindowStart: '10:00',
      sendWindowEnd: '17:00',
      sendDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    },
    ...overrides,
  };
}

function codes(ctx: GateContext): GateFailureCode[] {
  return evaluateSendGate(ctx).blocking.map((f) => f.code);
}

const contact = baseCtx().contact!;
const email = baseCtx().email;

describe('evaluateSendGate', () => {
  it('passes when every rule holds', () => {
    const r = evaluateSendGate(baseCtx());
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
  });

  const cases: [string, Partial<GateContext>, GateFailureCode][] = [
    ['no contact', { contact: null }, 'contact_missing'],
    ['unverified contact', { contact: { ...contact, verified: false } }, 'contact_not_verified'],
    ['missing source URL', { contact: { ...contact, sourceUrl: null } }, 'source_url_invalid'],
    ['non-http source URL', { contact: { ...contact, sourceUrl: 'ftp://x.org/a' } }, 'source_url_invalid'],
    [
      'bare-domain source URL',
      { contact: { ...contact, sourceUrl: 'realcollege.edu.in' } },
      'source_url_invalid',
    ],
    ['invalid email syntax', { contact: { ...contact, email: 'not-an-email' } }, 'email_invalid'],
    ['missing email', { contact: { ...contact, email: null } }, 'email_invalid'],
    [
      'example.edu email',
      { contact: { ...contact, email: 'placement@example.edu' } },
      'email_example_domain',
    ],
    ['example.com email', { contact: { ...contact, email: 'training@example.com' } }, 'email_example_domain'],
    ['sample domain email', { contact: { ...contact, email: 'hr@sample.co.in' } }, 'email_example_domain'],
    ['opted-out contact', { contact: { ...contact, optOut: true } }, 'contact_opted_out'],
    ['suppressed address', { suppressed: true }, 'email_suppressed'],
    [
      'do-not-contact organisation',
      { organisation: { recordId: 'WF-000001', doNotContact: true } },
      'organisation_do_not_contact',
    ],
    ['ZeroBounce invalid', { contact: { ...contact, emailCheckStatus: 'invalid' } }, 'email_check_invalid'],
    ['status not queued at send stage', { email: { ...email, status: 'approved' } }, 'not_approved'],
    ['draft email', { email: { ...email, status: 'draft' } }, 'not_approved'],
    ['pending approval email', { email: { ...email, status: 'pending_approval' } }, 'not_approved'],
    [
      'approval not recorded (no approver)',
      { email: { ...email, approvedBy: null } },
      'approval_not_recorded',
    ],
    ['approval not recorded (no time)', { email: { ...email, approvedAt: null } }, 'approval_not_recorded'],
    [
      'recent send to contact in another thread',
      {
        recentSendsToContact: [
          { id: 'other', sentAt: new Date(NOW.getTime() - 2 * 86400000), threadId: 'other' },
        ],
      },
      'recent_send_to_contact',
    ],
    ['follow-up number above 2', { email: { ...email, followUpNo: 3 } }, 'follow_up_limit'],
    ['hourly cap reached', { sendsThisHour: 10 }, 'hourly_cap'],
    ['daily cap reached', { sendsToday: 30 }, 'daily_cap'],
    ['before send window', { now: istWallClockToUtc(2026, 10, 27, 9, 59) }, 'outside_send_window'],
    ['at window end', { now: istWallClockToUtc(2026, 10, 27, 17, 0) }, 'outside_send_window'],
    ['on a Sunday', { now: istWallClockToUtc(2026, 11, 1, 11, 0) }, 'outside_send_days'],
    ['SAMPLE- record', { organisation: { recordId: 'SAMPLE-001', doNotContact: false } }, 'sample_record'],
  ];

  it.each(cases)('fails: %s', (_label, overrides, code) => {
    const ctx = baseCtx(overrides);
    expect(evaluateSendGate(ctx).ok).toBe(false);
    expect(codes(ctx)).toContain(code);
  });

  it('passes for catch_all / risky / unknown verification statuses (warning only)', () => {
    for (const s of ['catch_all', 'risky', 'unknown'] as const) {
      expect(evaluateSendGate(baseCtx({ contact: { ...contact, emailCheckStatus: s } })).ok).toBe(true);
    }
  });

  it('allows follow-up 1 and 2', () => {
    const ctx = baseCtx({ email: { ...email, followUpNo: 2, parentEmailId: 'p', threadId: 'p' } });
    expect(evaluateSendGate(ctx).ok).toBe(true);
  });

  it('allows an approved follow-up in the same thread within 7 days', () => {
    const r = evaluateSendGate(
      baseCtx({
        email: { ...email, id: 'f1', followUpNo: 1, parentEmailId: 'root', threadId: 'root' },
        recentSendsToContact: [
          { id: 'root', sentAt: new Date(NOW.getTime() - 3 * 86400000), threadId: 'root' },
        ],
      }),
    );
    expect(r.ok).toBe(true);
  });

  it('blocks a first contact even when thread ids match (only follow-ups are exempt)', () => {
    const r = evaluateSendGate(
      baseCtx({
        email: { ...email, id: 'new', parentEmailId: null, threadId: 'root' },
        recentSendsToContact: [
          { id: 'root', sentAt: new Date(NOW.getTime() - 3 * 86400000), threadId: 'root' },
        ],
      }),
    );
    expect(r.blocking.map((f) => f.code)).toContain('recent_send_to_contact');
  });

  it('ignores sends older than 7 days', () => {
    const r = evaluateSendGate(
      baseCtx({
        recentSendsToContact: [
          { id: 'old', sentAt: new Date(NOW.getTime() - 8 * 86400000), threadId: 'old' },
        ],
      }),
    );
    expect(r.ok).toBe(true);
  });

  it('passes just below caps', () => {
    expect(evaluateSendGate(baseCtx({ sendsThisHour: 9, sendsToday: 29 })).ok).toBe(true);
  });

  it('respects a cap of 2', () => {
    const settings = { ...baseCtx().settings, hourlySendCap: 2, dailySendCap: 2 };
    expect(evaluateSendGate(baseCtx({ settings, sendsToday: 1, sendsThisHour: 1 })).ok).toBe(true);
    expect(evaluateSendGate(baseCtx({ settings, sendsToday: 2, sendsThisHour: 0 })).ok).toBe(false);
  });

  describe('queue stage', () => {
    it('requires status approved', () => {
      expect(evaluateSendGate(baseCtx({ stage: 'queue', email: { ...email, status: 'approved' } })).ok).toBe(
        true,
      );
      expect(codes(baseCtx({ stage: 'queue', email: { ...email, status: 'queued' } }))).toContain(
        'not_approved',
      );
    });

    it('reports but does not block on timing rules', () => {
      const r = evaluateSendGate(
        baseCtx({
          stage: 'queue',
          email: { ...email, status: 'approved' },
          sendsToday: 99,
          now: istWallClockToUtc(2026, 11, 1, 3, 0),
        }),
      );
      expect(r.ok).toBe(true);
      expect(r.failures.map((f) => f.code)).toEqual(
        expect.arrayContaining(['daily_cap', 'outside_send_days', 'outside_send_window']),
      );
    });

    it('still blocks non-timing rules', () => {
      const r = evaluateSendGate(
        baseCtx({
          stage: 'queue',
          email: { ...email, status: 'approved' },
          contact: { ...contact, optOut: true },
        }),
      );
      expect(r.ok).toBe(false);
    });
  });
});

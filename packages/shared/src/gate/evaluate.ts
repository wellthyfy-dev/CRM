import type { EmailCheckStatus, EmailStatus } from '../constants';
import { MAX_FOLLOW_UPS, RECENT_SEND_DAYS } from '../constants';
import { isExampleDomain, isHttpUrl, isValidEmailSyntax } from '../email';
import { isSendDay, isWithinSendWindow } from '../time';

// Pure evaluation of the send gate (CLAUDE.md safety rule 2). The DB-backed `checkSendGate(emailId)` in
// `@wellthyfy/shared/server` loads a GateContext and calls this. Keep every rule here so it is unit-tested.

export const GATE_FAILURE_CODES = [
  'contact_missing',
  'contact_not_verified',
  'source_url_invalid',
  'email_invalid',
  'email_example_domain',
  'contact_opted_out',
  'email_suppressed',
  'organisation_do_not_contact',
  'email_check_invalid',
  'not_approved',
  'approval_not_recorded',
  'recent_send_to_contact',
  'follow_up_limit',
  'hourly_cap',
  'daily_cap',
  'outside_send_window',
  'outside_send_days',
  'sample_record',
] as const;
export type GateFailureCode = (typeof GATE_FAILURE_CODES)[number];

/** Failures that only mean "not now" — the worker waits instead of failing the email. */
export const TIMING_FAILURE_CODES: readonly GateFailureCode[] = [
  'hourly_cap',
  'daily_cap',
  'outside_send_window',
  'outside_send_days',
];

/**
 * Stage of the gate:
 * - `queue`: admin presses Send. Email must be `approved`. Timing rules are reported but do not block queueing,
 *   because the worker enforces them right before SMTP.
 * - `send`: worker, immediately before SMTP. Email must be `queued` (only reachable from `approved`); all rules apply.
 * - `preview`: same as `queue`, used to display gate status in the UI.
 */
export type GateStage = 'queue' | 'send' | 'preview';

export interface GateContext {
  stage: GateStage;
  now: Date;
  email: {
    id: string;
    status: EmailStatus;
    approvedBy: string | null;
    approvedAt: Date | null;
    followUpNo: number;
    parentEmailId: string | null;
    threadId: string | null;
  };
  contact: {
    email: string | null;
    verified: boolean;
    sourceUrl: string | null;
    optOut: boolean;
    emailCheckStatus: EmailCheckStatus;
  } | null;
  organisation: { recordId: string; doNotContact: boolean };
  /** Address appears on the permanent suppression list (opt-outs survive contact deletion). */
  suppressed: boolean;
  /** Other emails already sent to this contact (any thread) with their sent time and thread. */
  recentSendsToContact: { id: string; sentAt: Date; threadId: string | null }[];
  sendsThisHour: number;
  sendsToday: number;
  settings: {
    hourlySendCap: number;
    dailySendCap: number;
    sendWindowStart: string;
    sendWindowEnd: string;
    sendDays: string[];
  };
}

export interface GateFailure {
  code: GateFailureCode;
  message: string;
}

export interface GateResult {
  ok: boolean;
  failures: GateFailure[];
  /** Failures that block this stage (timing failures are excluded at the queue/preview stage). */
  blocking: GateFailure[];
}

export function evaluateSendGate(ctx: GateContext): GateResult {
  const failures: GateFailure[] = [];
  const fail = (code: GateFailureCode, message: string) => failures.push({ code, message });
  const { contact, email, organisation, settings, now } = ctx;

  if (!contact) {
    fail('contact_missing', 'Email has no contact');
  } else {
    if (!contact.verified) fail('contact_not_verified', 'Contact is not verified');
    if (!isHttpUrl(contact.sourceUrl))
      fail('source_url_invalid', 'Contact source URL must start with http:// or https://');
    if (!contact.email || !isValidEmailSyntax(contact.email)) {
      fail('email_invalid', 'Contact email is missing or has invalid syntax');
    } else if (isExampleDomain(contact.email)) {
      fail('email_example_domain', 'Contact email uses an example/sample domain');
    }
    if (contact.optOut) fail('contact_opted_out', 'Contact has opted out');
    if (contact.emailCheckStatus === 'invalid')
      fail('email_check_invalid', 'Email verification returned invalid');
  }
  if (ctx.suppressed) fail('email_suppressed', 'Address is on the permanent opt-out list');
  if (organisation.doNotContact) fail('organisation_do_not_contact', 'Organisation is marked do-not-contact');
  if (organisation.recordId.toUpperCase().startsWith('SAMPLE-'))
    fail('sample_record', 'SAMPLE- records are never emailed');

  const expectedStatus: EmailStatus = ctx.stage === 'send' ? 'queued' : 'approved';
  if (email.status !== expectedStatus) {
    fail('not_approved', `Email status is "${email.status}", expected "${expectedStatus}"`);
  }
  if (!email.approvedBy || !email.approvedAt) {
    fail('approval_not_recorded', 'No human approval recorded (approved_by / approved_at)');
  }

  if (email.followUpNo > MAX_FOLLOW_UPS)
    fail('follow_up_limit', `Follow-up number exceeds ${MAX_FOLLOW_UPS}`);

  const windowStart = now.getTime() - RECENT_SEND_DAYS * 86400000;
  const isFollowUpInThread = !!email.parentEmailId && !!email.threadId;
  const conflicting = ctx.recentSendsToContact.filter(
    (s) =>
      s.id !== email.id &&
      s.sentAt.getTime() > windowStart &&
      !(isFollowUpInThread && s.threadId === email.threadId),
  );
  if (conflicting.length > 0) {
    fail(
      'recent_send_to_contact',
      `Another email was sent to this contact in the last ${RECENT_SEND_DAYS} days`,
    );
  }

  if (ctx.sendsThisHour >= settings.hourlySendCap) {
    fail('hourly_cap', `Hourly send cap reached (${ctx.sendsThisHour}/${settings.hourlySendCap})`);
  }
  if (ctx.sendsToday >= settings.dailySendCap) {
    fail('daily_cap', `Daily send cap reached (${ctx.sendsToday}/${settings.dailySendCap})`);
  }
  if (!isSendDay(now, settings.sendDays)) {
    fail('outside_send_days', 'Today is not a send day (Asia/Kolkata)');
  }
  if (!isWithinSendWindow(now, settings.sendWindowStart, settings.sendWindowEnd)) {
    fail(
      'outside_send_window',
      `Outside send window ${settings.sendWindowStart}–${settings.sendWindowEnd} IST`,
    );
  }

  const blocking =
    ctx.stage === 'send' ? failures : failures.filter((f) => !TIMING_FAILURE_CODES.includes(f.code));
  return { ok: blocking.length === 0, failures, blocking };
}

export function formatGateFailures(failures: GateFailure[]): string {
  return failures.map((f) => `${f.code}: ${f.message}`).join('; ');
}

export function onlyTimingFailures(failures: GateFailure[]): boolean {
  return failures.length > 0 && failures.every((f) => TIMING_FAILURE_CODES.includes(f.code));
}

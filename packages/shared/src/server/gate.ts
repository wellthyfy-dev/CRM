import { and, eq, gte, inArray, isNotNull, ne } from 'drizzle-orm';
import { count } from 'drizzle-orm';
import { RECENT_SEND_DAYS } from '../constants';
import type { Db } from '../db/client';
import { contacts, emails, organisations } from '../db/schema';
import {
  evaluateSendGate,
  formatGateFailures,
  type GateContext,
  type GateResult,
  type GateStage,
} from '../gate/evaluate';
import { startOfIstDay, startOfIstHour } from '../time';
import { getSettings } from './settings';
import { isSuppressed } from './suppression';

export interface CheckSendGateOptions {
  stage: GateStage;
  now?: Date;
  /** Persist gate_failure_reason on the email (default true except for preview). */
  record?: boolean;
}

/** Emails that count towards send caps and the 7-day rule (anything that actually left the mailbox). */
const SENT_STATUSES = ['sent', 'replied', 'bounced'] as const;

export async function countSendsSince(db: Db, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(emails)
    .where(and(isNotNull(emails.sentAt), gte(emails.sentAt, since)));
  return Number(row?.n ?? 0);
}

export async function loadGateContext(
  db: Db,
  emailId: string,
  stage: GateStage,
  now: Date,
): Promise<GateContext | null> {
  const [email] = await db.select().from(emails).where(eq(emails.id, emailId));
  if (!email) return null;
  const [org] = await db.select().from(organisations).where(eq(organisations.id, email.organisationId));
  if (!org) return null;
  const contact = email.contactId
    ? ((await db.select().from(contacts).where(eq(contacts.id, email.contactId)))[0] ?? null)
    : null;
  const s = await getSettings(db);

  const recent = contact
    ? await db
        .select({ id: emails.id, sentAt: emails.sentAt, threadId: emails.threadId })
        .from(emails)
        .where(
          and(
            eq(emails.contactId, contact.id),
            ne(emails.id, email.id),
            inArray(emails.status, [...SENT_STATUSES]),
            gte(emails.sentAt, new Date(now.getTime() - RECENT_SEND_DAYS * 86400000)),
          ),
        )
    : [];

  return {
    stage,
    now,
    email: {
      id: email.id,
      status: email.status,
      approvedBy: email.approvedBy,
      approvedAt: email.approvedAt,
      followUpNo: email.followUpNo,
      parentEmailId: email.parentEmailId,
      threadId: email.threadId,
    },
    contact: contact
      ? {
          email: contact.email,
          verified: contact.verified,
          sourceUrl: contact.sourceUrl,
          optOut: contact.optOut,
          emailCheckStatus: contact.emailCheckStatus,
        }
      : null,
    organisation: { recordId: org.recordId, doNotContact: org.doNotContact },
    suppressed: contact?.email ? await isSuppressed(db, contact.email) : false,
    recentSendsToContact: recent
      .filter((r): r is { id: string; sentAt: Date; threadId: string | null } => r.sentAt !== null)
      .map((r) => ({ id: r.id, sentAt: r.sentAt, threadId: r.threadId })),
    sendsThisHour: await countSendsSince(db, startOfIstHour(now)),
    sendsToday: await countSendsSince(db, startOfIstDay(now)),
    settings: {
      hourlySendCap: s.hourlySendCap,
      dailySendCap: s.dailySendCap,
      sendWindowStart: s.sendWindowStart,
      sendWindowEnd: s.sendWindowEnd,
      sendDays: s.sendDays,
    },
  };
}

/**
 * The single send gate (CLAUDE.md safety rule 2). Used by the API when queueing and re-run by the worker
 * immediately before SMTP. On failure the reason is stored on the email; on success it is cleared.
 */
export async function checkSendGate(
  db: Db,
  emailId: string,
  opts: CheckSendGateOptions,
): Promise<GateResult> {
  const now = opts.now ?? new Date();
  const ctx = await loadGateContext(db, emailId, opts.stage, now);
  if (!ctx) {
    return {
      ok: false,
      failures: [{ code: 'contact_missing', message: 'Email or organisation not found' }],
      blocking: [{ code: 'contact_missing', message: 'Email or organisation not found' }],
    };
  }
  const result = evaluateSendGate(ctx);
  const record = opts.record ?? opts.stage !== 'preview';
  if (record) {
    await db
      .update(emails)
      .set({ gateFailureReason: result.ok ? null : formatGateFailures(result.blocking) })
      .where(eq(emails.id, emailId));
  }
  return result;
}

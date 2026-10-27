import { and, asc, eq, isNull, lte, or } from 'drizzle-orm';
import {
  advanceOrg,
  checkSendGate,
  classifySmtpError,
  contacts,
  emails,
  getSettings,
  logActivity,
  QUEUES,
  settings,
  type Email,
} from '@wellthyfy/shared/server';
import { formatGateFailures, isSendDay, isWithinSendWindow, onlyTimingFailures } from '@wellthyfy/shared';
import { composeEmail, loadEmailWithContact, senderAddress } from '../lib/compose';
import type { JobDefinition, WorkerDeps } from '../runtime';

export const MAX_SEND_ATTEMPTS = 5;
export const PAUSE_ON_TRANSIENT_MS = 60 * 60_000;

export type SendTickResult =
  | { action: 'idle'; reason: string }
  | { action: 'sent'; emailId: string }
  | { action: 'blocked'; emailId: string; reason: string }
  | { action: 'waiting'; emailId: string; reason: string }
  | { action: 'error'; emailId: string; kind: string };

async function pickNext(deps: WorkerDeps): Promise<Email | null> {
  const [next] = await deps.db
    .select()
    .from(emails)
    .where(
      and(eq(emails.status, 'queued'), or(isNull(emails.scheduledFor), lte(emails.scheduledFor, deps.now()))),
    )
    .orderBy(asc(emails.queuedAt), asc(emails.createdAt))
    .limit(1);
  return next ?? null;
}

async function onSent(deps: WorkerDeps, email: Email, raw: Buffer, messageId: string) {
  const { db, mail, logger, now } = deps;
  await db
    .update(emails)
    .set({
      status: 'sent',
      sentAt: now(),
      messageId,
      sendAttempts: email.sendAttempts + 1,
      error: null,
      gateFailureReason: null,
    })
    .where(eq(emails.id, email.id));
  // Copy to Sent (\Seen) and remove our Titan draft. Failures here must not undo a successful send.
  await mail
    .appendSent(raw)
    .catch((err) => logger.warn({ err: (err as Error).message }, 'append to Sent failed'));
  if (email.imapDraftUid) {
    await mail
      .deleteDraft(email.imapDraftUid)
      .catch((err) => logger.warn({ err: (err as Error).message }, 'draft delete failed'));
    await db.update(emails).set({ imapDraftUid: null }).where(eq(emails.id, email.id));
  }
  await logActivity(db, {
    organisationId: email.organisationId,
    type: 'email_sent',
    payload: {
      emailId: email.id,
      subject: email.subject,
      kind: email.kind,
      followUpNo: email.followUpNo,
      dryRun: mail.mode === 'dry_run',
    },
  });
  await advanceOrg(
    db,
    email.organisationId,
    email.kind === 'proposal' ? 'proposal_sent' : 'sent',
    null,
    'email sent',
  );
  // Random 60–180 s gap before the next send.
  const gap = deps.randomGapSeconds();
  await db
    .update(settings)
    .set({ nextSendAfter: new Date(now().getTime() + gap * 1000) })
    .where(eq(settings.id, 1));
  await deps.publisher.send(QUEUES.sendTick, {}, { startAfterSeconds: gap, singletonKey: 'send-tick-gap' });
}

async function onError(deps: WorkerDeps, email: Email, err: unknown): Promise<SendTickResult> {
  const { db, now, logger } = deps;
  const kind = classifySmtpError(err);
  const attempts = email.sendAttempts + 1;
  const message = `${kind}: ${(err as Error)?.message ?? 'unknown error'}`.slice(0, 500);
  logger.warn({ emailId: email.id, kind, attempts }, 'send failed');

  if (kind === 'rate_limit' || kind === 'network') {
    const giveUp = attempts >= MAX_SEND_ATTEMPTS;
    const backoffMs = Math.min(2 ** attempts * 60_000, 4 * 60 * 60_000);
    await db
      .update(emails)
      .set({
        sendAttempts: attempts,
        error: message,
        status: giveUp ? 'failed' : 'queued',
        scheduledFor: giveUp ? null : new Date(now().getTime() + backoffMs),
      })
      .where(eq(emails.id, email.id));
    await db
      .update(settings)
      .set({
        queuePausedUntil: new Date(now().getTime() + PAUSE_ON_TRANSIENT_MS),
        queuePauseReason: `Paused 1 hour after ${kind} error`,
      })
      .where(eq(settings.id, 1));
  } else if (kind === 'rejected_recipient') {
    await db
      .update(emails)
      .set({ status: 'failed', sendAttempts: attempts, error: message })
      .where(eq(emails.id, email.id));
    if (email.contactId) {
      await db
        .update(contacts)
        .set({ emailCheckStatus: 'invalid', emailCheckedAt: now() })
        .where(eq(contacts.id, email.contactId));
    }
  } else if (kind === 'auth') {
    // Keep the email queued; stop everything until an admin fixes the credentials.
    await db.update(emails).set({ sendAttempts: attempts, error: message }).where(eq(emails.id, email.id));
    await db
      .update(settings)
      .set({
        queuePaused: true,
        queuePauseReason: 'Titan SMTP authentication failed — check TITAN_USER / TITAN_PASSWORD',
      })
      .where(eq(settings.id, 1));
    await deps.notifier
      .send({
        subject: 'Sending paused: Titan authentication failed',
        text: 'The outreach queue has been paused because Titan SMTP rejected the login. Fix the credentials, use Settings → Test Titan connection, then resume the queue.',
      })
      .catch(() => {});
  } else {
    await db
      .update(emails)
      .set({ status: 'failed', sendAttempts: attempts, error: message })
      .where(eq(emails.id, email.id));
  }
  await logActivity(db, {
    organisationId: email.organisationId,
    type: 'email_send_failed',
    payload: { emailId: email.id, kind, attempts },
  });
  return { action: 'error', emailId: email.id, kind };
}

/** One step of the send queue: sends at most one email. */
export async function sendTick(deps: WorkerDeps): Promise<SendTickResult> {
  const { db, now } = deps;
  const s = await getSettings(db);
  const t = now();
  if (s.queuePaused) return { action: 'idle', reason: s.queuePauseReason ?? 'Queue paused' };
  if (s.queuePausedUntil && s.queuePausedUntil > t)
    return { action: 'idle', reason: s.queuePauseReason ?? 'Queue paused' };
  if (s.nextSendAfter && s.nextSendAfter > t)
    return { action: 'idle', reason: 'Waiting for the gap between sends' };
  if (!isSendDay(t, s.sendDays) || !isWithinSendWindow(t, s.sendWindowStart, s.sendWindowEnd)) {
    return { action: 'idle', reason: 'Outside send window' };
  }
  const email = await pickNext(deps);
  if (!email) return { action: 'idle', reason: 'Nothing queued' };

  // Re-run the gate immediately before SMTP (safety rule 2).
  const gate = await checkSendGate(db, email.id, { stage: 'send', now: t });
  if (!gate.ok) {
    if (onlyTimingFailures(gate.blocking))
      return { action: 'waiting', emailId: email.id, reason: formatGateFailures(gate.blocking) };
    await db
      .update(emails)
      .set({ status: 'failed', error: 'Blocked by send gate' })
      .where(eq(emails.id, email.id));
    await logActivity(db, {
      organisationId: email.organisationId,
      type: 'email_blocked',
      payload: { emailId: email.id, reasons: gate.blocking.map((f) => f.code) },
    });
    return { action: 'blocked', emailId: email.id, reason: formatGateFailures(gate.blocking) };
  }

  const loaded = await loadEmailWithContact(deps, email.id);
  const contact = loaded?.contact;
  if (!loaded || !contact?.email) return { action: 'blocked', emailId: email.id, reason: 'contact missing' };
  const { raw, messageId } = await composeEmail(deps, loaded.email, contact);
  try {
    await deps.mail.send({ from: senderAddress(deps), to: contact.email }, raw);
  } catch (err) {
    return onError(deps, loaded.email, err);
  }
  await onSent(deps, loaded.email, raw, messageId);
  return { action: 'sent', emailId: email.id };
}

export const sendTickJob: JobDefinition = {
  queue: QUEUES.sendTick,
  cron: '* * * * *',
  async handler(deps) {
    const result = await sendTick(deps);
    if (result.action !== 'idle') deps.logger.info(result, 'send tick');
  },
};

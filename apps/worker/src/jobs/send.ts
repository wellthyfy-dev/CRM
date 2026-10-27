import { and, asc, eq, isNull, lte, or } from 'drizzle-orm';
import {
  advanceOrg,
  checkSendGate,
  classifySmtpError,
  contacts,
  effectiveOptOutLine,
  emails,
  getSettings,
  logActivity,
  proposals,
  QUEUES,
  settings,
  type Email,
  type Settings,
} from '@wellthyfy/shared/server';
import {
  ensureOptOutLine,
  formatGateFailures,
  isSendDay,
  isWithinSendWindow,
  onlyTimingFailures,
} from '@wellthyfy/shared';
import { composeEmail, loadEmailWithContact, senderAddress } from '../lib/compose';
import type { JobDefinition, WorkerDeps } from '../runtime';

export const MAX_SEND_ATTEMPTS = 5;
/** Lease held while one email is being sent (expires on its own if the worker dies mid-send). */
export const SEND_LEASE_MS = 10 * 60_000;
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
  if (email.kind === 'proposal') {
    await db.update(proposals).set({ status: 'sent', sentAt: now() }).where(eq(proposals.emailId, email.id));
  }
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
  // Atomic lease on the settings row: only one tick (across any number of worker instances) may send at a time.
  const lease = new Date(t.getTime() + SEND_LEASE_MS);
  const claimed = await db
    .update(settings)
    .set({ nextSendAfter: lease })
    .where(and(eq(settings.id, 1), or(isNull(settings.nextSendAfter), lte(settings.nextSendAfter, t))))
    .returning({ id: settings.id });
  if (claimed.length === 0) return { action: 'idle', reason: 'Another send is in progress' };
  let result: SendTickResult = { action: 'idle', reason: 'Nothing queued' };
  try {
    result = await sendOne(deps, s, t);
    return result;
  } finally {
    // A successful send replaces the lease with the random gap; otherwise release it.
    if (result.action !== 'sent') {
      await db
        .update(settings)
        .set({ nextSendAfter: null })
        .where(and(eq(settings.id, 1), eq(settings.nextSendAfter, lease)));
    }
  }
}

async function sendOne(deps: WorkerDeps, s: Settings, t: Date): Promise<SendTickResult> {
  const { db } = deps;
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
  // Safety rule 4: the opt-out line must end every outreach email, even if settings changed after drafting.
  const body = ensureOptOutLine(loaded.email.body, effectiveOptOutLine(s));
  if (body !== loaded.email.body) {
    await db.update(emails).set({ body }).where(eq(emails.id, loaded.email.id));
    loaded.email.body = body;
  }
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

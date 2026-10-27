import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  addDays,
  classifyByRules,
  extractMessageIds,
  normaliseEmail,
  OOO_SHIFT_DAYS,
  replySnippet,
  stripQuoted,
  type ReplyClassification,
} from '@wellthyfy/shared';
import {
  advanceOrg,
  aiBudgetAvailable,
  contacts,
  effectiveAiModel,
  emails,
  getSettings,
  logActivity,
  QUEUES,
  recordAiUsage,
  replies,
  settings,
  suppress,
  type Contact,
  type Email,
} from '@wellthyfy/shared/server';
import type { JobDefinition, ParsedMail, WorkerDeps } from '../runtime';

const UNSENT = ['draft', 'pending_approval', 'approved', 'queued'] as const;

/** Match an inbound message to one of our sent emails: In-Reply-To/References first, then sender = contact email. */
export async function matchInbound(
  deps: Pick<WorkerDeps, 'db'>,
  msg: ParsedMail,
  isBounce: boolean,
): Promise<{ email: Email | null; contact: Contact | null }> {
  const { db } = deps;
  const ids = [msg.inReplyTo, ...msg.references].filter((x): x is string => !!x);
  // Bounces quote the original message (and its Message-ID) in the body.
  if (isBounce) ids.push(...extractMessageIds(msg.text));
  if (ids.length) {
    const [email] = await db
      .select()
      .from(emails)
      .where(and(inArray(emails.messageId, ids), isNotNull(emails.sentAt)));
    if (email) {
      const [contact] = email.contactId
        ? await db.select().from(contacts).where(eq(contacts.id, email.contactId))
        : [];
      return { email, contact: contact ?? null };
    }
  }
  const from = normaliseEmail(msg.fromAddress);
  const [contact] = from ? await db.select().from(contacts).where(eq(contacts.email, from)) : [];
  if (!contact) return { email: null, contact: null };
  const [email] = await db
    .select()
    .from(emails)
    .where(and(eq(emails.contactId, contact.id), isNotNull(emails.sentAt)))
    .orderBy(desc(emails.sentAt))
    .limit(1);
  return { email: email ?? null, contact };
}

async function cancelPendingFollowUps(deps: WorkerDeps, threadId: string, reason: string) {
  const rows = await deps.db
    .update(emails)
    .set({ status: 'cancelled', error: reason })
    .where(
      and(eq(emails.threadId, threadId), inArray(emails.status, [...UNSENT]), sql`${emails.followUpNo} > 0`),
    )
    .returning({ id: emails.id, organisationId: emails.organisationId });
  for (const r of rows) {
    await logActivity(deps.db, {
      organisationId: r.organisationId,
      type: 'email_cancelled',
      payload: { emailId: r.id, reason },
    });
  }
}

export async function processInbound(
  deps: WorkerDeps,
  msg: ParsedMail,
  uid: number | null,
): Promise<{ replyId: string | null; classification: ReplyClassification | null }> {
  const { db, now, env } = deps;
  if (normaliseEmail(msg.fromAddress) === normaliseEmail(env.TITAN_USER ?? ''))
    return { replyId: null, classification: null };
  const rule = classifyByRules({
    fromAddress: msg.fromAddress,
    subject: msg.subject,
    text: msg.text,
    headers: msg.headers,
    contentType: msg.contentType,
  });
  const { email, contact } = await matchInbound(deps, msg, rule === 'bounce');
  // Only messages that relate to our outreach are stored (nothing else from the inbox is read into the CRM).
  if (!email && !contact) return { replyId: null, classification: null };

  let classification: ReplyClassification = rule ?? 'other';
  let summary: string | null = null;
  const own = stripQuoted(msg.text);
  if (!rule) {
    const s = await getSettings(db);
    if (deps.ai.configured && (await aiBudgetAvailable(db, s, now()))) {
      try {
        const model = effectiveAiModel(s, env.AI_MODEL_DEFAULT);
        const res = await deps.ai.classifyReply(model, `Subject: ${msg.subject}\n\n${own}`);
        classification = res.output.classification;
        summary = res.output.summary;
        await recordAiUsage(
          db,
          {
            purpose: 'reply_classification',
            model,
            tokensIn: res.tokensIn,
            tokensOut: res.tokensOut,
            organisationId: email?.organisationId ?? contact?.organisationId,
          },
          env.USD_TO_INR,
        );
      } catch (err) {
        deps.logger.warn({ err: (err as Error).message }, 'AI reply classification failed; using "other"');
      }
    }
  }

  const organisationId = email?.organisationId ?? contact?.organisationId ?? null;
  const [reply] = await db
    .insert(replies)
    .values({
      emailId: email?.id ?? null,
      organisationId,
      contactId: contact?.id ?? null,
      fromEmail: normaliseEmail(msg.fromAddress),
      subject: msg.subject.slice(0, 500),
      snippet: replySnippet(msg.text),
      receivedAt: msg.date ?? now(),
      messageId: msg.messageId,
      imapUid: uid,
      classification,
      summary,
    })
    .onConflictDoNothing()
    .returning({ id: replies.id });
  if (!reply) return { replyId: null, classification }; // already processed

  const threadId = email?.threadId ?? email?.id ?? null;
  if (classification === 'bounce') {
    if (email) await db.update(emails).set({ status: 'bounced' }).where(eq(emails.id, email.id));
    if (contact) {
      await db
        .update(contacts)
        .set({ emailCheckStatus: 'invalid', emailCheckedAt: now() })
        .where(eq(contacts.id, contact.id));
    }
    if (threadId) await cancelPendingFollowUps(deps, threadId, 'Original email bounced');
  } else if (classification === 'out_of_office') {
    // Auto-replies are not real replies: shift follow-ups by 7 days instead of cancelling them.
    if (email) {
      const rootId = threadId ?? email.id;
      await db
        .update(emails)
        .set({ followUpOffsetDays: sql`${emails.followUpOffsetDays} + ${OOO_SHIFT_DAYS}` })
        .where(eq(emails.id, rootId));
      const pending = await db
        .select()
        .from(emails)
        .where(
          and(
            eq(emails.threadId, rootId),
            inArray(emails.status, [...UNSENT]),
            sql`${emails.followUpNo} > 0`,
          ),
        );
      for (const p of pending) {
        await db
          .update(emails)
          .set({ scheduledFor: addDays(p.scheduledFor ?? now(), OOO_SHIFT_DAYS) })
          .where(eq(emails.id, p.id));
      }
    }
  } else {
    // A real reply: mark replied, move the stage, stop follow-ups.
    if (email && email.status === 'sent')
      await db.update(emails).set({ status: 'replied' }).where(eq(emails.id, email.id));
    if (organisationId) await advanceOrg(db, organisationId, 'replied', null, 'reply received');
    if (threadId) await cancelPendingFollowUps(deps, threadId, 'Contact replied');
    if (contact && (classification === 'unsubscribe' || classification === 'not_interested')) {
      await db
        .update(contacts)
        .set({ optOut: true, optOutAt: contact.optOutAt ?? now() })
        .where(eq(contacts.id, contact.id));
      if (contact.email) await suppress(db, contact.email, `reply: ${classification}`);
      const rows = await db
        .update(emails)
        .set({ status: 'cancelled', error: 'Contact opted out' })
        .where(and(eq(emails.contactId, contact.id), inArray(emails.status, [...UNSENT])))
        .returning({ id: emails.id });
      await logActivity(db, {
        organisationId,
        type: 'contact_opted_out',
        payload: { contactId: contact.id, source: `reply (${classification})`, cancelledEmails: rows.length },
      });
    }
    if (classification === 'interested') await deps.publisher.send(QUEUES.replyAlert, { replyId: reply.id });
  }
  await logActivity(db, {
    organisationId,
    type: 'reply_received',
    payload: { replyId: reply.id, emailId: email?.id ?? null, classification, summary, subject: msg.subject },
  });
  return { replyId: reply.id, classification };
}

/** Poll INBOX read-only from settings.imap_last_uid. Never deletes, moves or flags messages. */
export async function pollInbox(deps: WorkerDeps): Promise<{ processed: number }> {
  const { db } = deps;
  const s = await getSettings(db);
  const result = await deps.mail.fetchInbox(s.imapLastUid, s.imapUidValidity);
  let lastUid = result.resetTo ?? s.imapLastUid;
  let processed = 0;
  for (const m of result.messages.sort((a, b) => a.uid - b.uid)) {
    try {
      await processInbound(deps, await deps.parseMail(m.source), m.uid);
      processed++;
    } catch (err) {
      deps.logger.error({ uid: m.uid, err: (err as Error).message }, 'failed to process inbound message');
    }
    lastUid = Math.max(lastUid, m.uid);
  }
  await db
    .update(settings)
    .set({ imapLastUid: lastUid, imapUidValidity: result.uidValidity || s.imapUidValidity })
    .where(eq(settings.id, 1));
  return { processed };
}

export const imapPollJob: JobDefinition = {
  queue: QUEUES.imapPoll,
  cron: '*/5 * * * *',
  async handler(deps) {
    const r = await pollInbox(deps);
    if (r.processed) deps.logger.info(r, 'inbox polled');
  },
};

import { and, count, eq, gte, isNotNull, lt, notInArray } from 'drizzle-orm';
import { addDays, formatIst, startOfIstDay } from '@wellthyfy/shared';
import { contacts, emails, organisations, QUEUES, replies } from '@wellthyfy/shared/server';
import type { JobDefinition, WorkerDeps } from '../runtime';

// Staff-only notifications through Resend (never prospects).

export async function buildDigest(deps: WorkerDeps): Promise<{ subject: string; text: string }> {
  const { db, now, env } = deps;
  const today = startOfIstDay(now());
  const open = notInArray(organisations.stage, ['training_confirmed', 'lost']);
  const due = await db
    .select({ name: organisations.name, recordId: organisations.recordId, at: organisations.nextFollowUpAt })
    .from(organisations)
    .where(and(open, lt(organisations.nextFollowUpAt, addDays(today, 1))))
    .orderBy(organisations.nextFollowUpAt)
    .limit(30);
  const [approvals] = await db
    .select({ n: count() })
    .from(emails)
    .where(eq(emails.status, 'pending_approval'));
  const openReplies = await db
    .select({
      from: replies.fromEmail,
      classification: replies.classification,
      summary: replies.summary,
      subject: replies.subject,
    })
    .from(replies)
    .where(eq(replies.handled, false))
    .limit(30);
  const [sentYesterday] = await db
    .select({ n: count() })
    .from(emails)
    .where(and(isNotNull(emails.sentAt), gte(emails.sentAt, addDays(today, -1)), lt(emails.sentAt, today)));
  const lines = [
    `Daily digest — ${formatIst(now(), false)}`,
    '',
    `Follow-ups due today or overdue: ${due.length}`,
    ...due.map((d) => `  • ${d.recordId} ${d.name} (${formatIst(d.at, false)})`),
    '',
    `Emails waiting for approval: ${Number(approvals?.n ?? 0)}`,
    '',
    `Replies needing attention: ${openReplies.length}`,
    ...openReplies.map((r) => `  • [${r.classification}] ${r.from}: ${r.summary ?? r.subject ?? ''}`),
    '',
    `Emails sent yesterday: ${Number(sentYesterday?.n ?? 0)}${env.EMAIL_MODE === 'dry_run' ? ' (dry run)' : ''}`,
    '',
    `Open the CRM: ${env.APP_URL.split(',')[0]}`,
  ];
  return { subject: 'Daily digest', text: lines.join('\n') };
}

export const digestJob: JobDefinition = {
  queue: QUEUES.digest,
  cron: '0 9 * * *',
  async handler(deps) {
    if (!deps.notifier.configured) return;
    await deps.notifier.send(await buildDigest(deps));
  },
};

export const replyAlertJob: JobDefinition = {
  queue: QUEUES.replyAlert,
  retryLimit: 3,
  async handler(deps, data) {
    if (!deps.notifier.configured) return;
    const [r] = await deps.db
      .select()
      .from(replies)
      .where(eq(replies.id, String(data.replyId ?? '')));
    if (!r) return;
    const [org] = r.organisationId
      ? await deps.db.select().from(organisations).where(eq(organisations.id, r.organisationId))
      : [];
    const [c] = r.contactId ? await deps.db.select().from(contacts).where(eq(contacts.id, r.contactId)) : [];
    await deps.notifier.send({
      subject: `Interested reply: ${org?.name ?? r.fromEmail}`,
      text: [
        `${c?.fullName || r.fromEmail} (${c?.designation ?? ''}) at ${org?.name ?? 'unknown organisation'} replied with interest.`,
        '',
        `Summary: ${r.summary ?? ''}`,
        `Snippet: ${r.snippet ?? ''}`,
        '',
        `${deps.env.APP_URL.split(',')[0]}/replies`,
      ].join('\n'),
    });
  },
};

import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { addDays, ensureOptOutLine, replySubject, TEMPLATE_KEYS } from '@wellthyfy/shared';
import {
  contacts,
  emails,
  getSettings,
  logActivity,
  organisations,
  QUEUES,
  renderForContact,
  replies,
  templates,
  type Email,
} from '@wellthyfy/shared/server';
import type { JobDefinition, WorkerDeps } from '../runtime';

/**
 * Daily: draft follow-up 1 after follow_up_1_days and follow-up 2 after follow_up_2_days for sent first-contact
 * emails with no reply and no opt-out. Drafts are pending_approval — a human must approve every follow-up.
 */
export async function createDueFollowUps(deps: WorkerDeps): Promise<{ created: string[] }> {
  const { db, now } = deps;
  const s = await getSettings(db);
  const created: string[] = [];
  const roots = await db
    .select()
    .from(emails)
    .where(and(eq(emails.kind, 'first_contact'), eq(emails.status, 'sent'), isNotNull(emails.sentAt)));

  for (const root of roots) {
    const [contact] = root.contactId
      ? await db.select().from(contacts).where(eq(contacts.id, root.contactId))
      : [];
    const [org] = await db.select().from(organisations).where(eq(organisations.id, root.organisationId));
    if (
      !contact ||
      !org ||
      contact.optOut ||
      org.doNotContact ||
      ['lost', 'training_confirmed'].includes(org.stage)
    )
      continue;
    const threadId = root.threadId ?? root.id;
    // Out-of-office auto-replies don't count as replies (they shift follow-ups instead).
    const hasReply = await db
      .select({ id: replies.id })
      .from(replies)
      .where(
        and(
          inArray(
            replies.emailId,
            db.select({ id: emails.id }).from(emails).where(eq(emails.threadId, threadId)),
          ),
          ne(replies.classification, 'out_of_office'),
        ),
      );

    if (hasReply.length) continue;
    const thread = await db.select().from(emails).where(eq(emails.threadId, threadId));
    const fu1 = thread.find((e) => e.followUpNo === 1);
    const fu2 = thread.find((e) => e.followUpNo === 2);
    const offset = root.followUpOffsetDays;
    const sentAt = root.sentAt!;

    let parent: Email | null = null;
    let number: 1 | 2 | null = null;
    if (!fu1 && now() >= addDays(sentAt, s.followUp1Days + offset)) {
      parent = root;
      number = 1;
    } else if (fu1?.status === 'sent' && !fu2 && now() >= addDays(sentAt, s.followUp2Days + offset)) {
      parent = fu1;
      number = 2;
    }
    if (!parent || !number) continue;

    const key = number === 1 ? TEMPLATE_KEYS.followUp1 : TEMPLATE_KEYS.followUp2;
    const [template] = await db.select().from(templates).where(eq(templates.key, key));
    if (!template) continue;
    const rendered = await renderForContact(db, org, contact, template);
    const references = [root.messageId, number === 2 ? fu1?.messageId : null].filter(Boolean).join(' ');
    const [fu] = await db
      .insert(emails)
      .values({
        organisationId: org.id,
        contactId: contact.id,
        templateId: template.id,
        templateVersion: template.version,
        kind: number === 1 ? 'follow_up_1' : 'follow_up_2',
        followUpNo: number,
        parentEmailId: parent.id,
        threadId,
        subject: replySubject(root.subject),
        body: ensureOptOutLine(rendered.body, rendered.optOutLine),
        status: 'pending_approval',
        submittedAt: now(),
        inReplyTo: parent.messageId,
        references: references || null,
      })
      .returning({ id: emails.id });
    created.push(fu!.id);
    await logActivity(db, {
      organisationId: org.id,
      type: 'follow_up_drafted',
      payload: { emailId: fu!.id, followUpNo: number, parentEmailId: parent.id },
    });
  }
  return { created };
}

export const followUpsJob: JobDefinition = {
  queue: QUEUES.followUps,
  cron: '0 8 * * *',
  async handler(deps) {
    const { created } = await createDueFollowUps(deps);
    deps.logger.info({ created: created.length }, 'follow-up drafts created');
  },
};

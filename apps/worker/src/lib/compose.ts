import { eq } from 'drizzle-orm';
import {
  buildRawMessage,
  contacts,
  emails,
  generateMessageId,
  type Contact,
  type Email,
  type OutgoingAttachment,
} from '@wellthyfy/shared/server';
import type { WorkerDeps } from '../runtime';

export function senderAddress(deps: Pick<WorkerDeps, 'env'>): string {
  return deps.env.TITAN_USER || 'ceo@wellthyfy.in';
}

export async function loadEmailWithContact(
  deps: Pick<WorkerDeps, 'db'>,
  emailId: string,
): Promise<{ email: Email; contact: Contact | null } | null> {
  const [email] = await deps.db.select().from(emails).where(eq(emails.id, emailId));
  if (!email) return null;
  const contact = email.contactId
    ? ((await deps.db.select().from(contacts).where(eq(contacts.id, email.contactId)))[0] ?? null)
    : null;
  return { email, contact };
}

/**
 * Build the RFC 5322 message for an email: From "TITAN_FROM_NAME <TITAN_USER>", Reply-To TITAN_USER, the stored
 * Message-ID (generated once and persisted), threading headers for follow-ups, plain text + simple HTML.
 */
export async function composeEmail(
  deps: Pick<WorkerDeps, 'db' | 'env' | 'downloadAttachment'>,
  email: Email,
  contact: Contact,
): Promise<{ raw: Buffer; messageId: string }> {
  const from = senderAddress(deps);
  let messageId = email.messageId;
  if (!messageId) {
    messageId = generateMessageId(from);
    await deps.db.update(emails).set({ messageId }).where(eq(emails.id, email.id));
  }
  const attachments: OutgoingAttachment[] = [];
  for (const a of email.attachments ?? []) {
    attachments.push({
      filename: a.filename,
      contentType: a.contentType,
      content: await deps.downloadAttachment(a.path),
    });
  }
  const raw = await buildRawMessage({
    fromName: deps.env.TITAN_FROM_NAME,
    fromAddress: from,
    to: contact.email ?? '',
    subject: email.subject,
    text: email.body,
    messageId,
    inReplyTo: email.inReplyTo,
    references: email.references,
    attachments,
  });
  return { raw, messageId };
}

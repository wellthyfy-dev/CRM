import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import { ImapFlow } from 'imapflow';
import type { Logger } from './logger';
import type { ServerEnv } from './env';

// Titan Mail is the ONLY channel for prospect email (CLAUDE.md). Credentials come from env only and are never logged.

export const TITAN = {
  smtpHost: 'smtp.titan.email',
  smtpPort: 465,
  imapHost: 'imap.titan.email',
  imapPort: 993,
} as const;

export interface OutgoingAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface OutgoingMessage {
  fromName: string;
  fromAddress: string;
  to: string;
  subject: string;
  text: string;
  messageId: string;
  inReplyTo?: string | null;
  references?: string | null;
  attachments?: OutgoingAttachment[];
}

export function generateMessageId(fromAddress: string): string {
  const domain = fromAddress.split('@')[1] || 'wellthyfy.in';
  return `<${randomUUID()}@${domain}>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Simple HTML alternative: paragraphs, line breaks and clickable http(s) links. */
export function textToHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) =>
      escapeHtml(p)
        .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
        .replace(/\n/g, '<br>'),
    )
    .map((p) => `<p style="margin:0 0 12px">${p}</p>`)
    .join('\n');
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">${paragraphs}</body></html>`;
}

/** Build the RFC 5322 message once; the same bytes (and Message-ID) are used for the draft, SMTP and Sent copy. */
export async function buildRawMessage(msg: OutgoingMessage): Promise<Buffer> {
  const composer = new MailComposer({
    from: { name: msg.fromName, address: msg.fromAddress },
    replyTo: msg.fromAddress,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: textToHtml(msg.text),
    messageId: msg.messageId,
    inReplyTo: msg.inReplyTo ?? undefined,
    references: msg.references ?? undefined,
    date: new Date(),
    attachments: msg.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    })),
    headers: { 'X-Mailer': 'Wellthyfy Outreach CRM' },
  });
  return new Promise((resolve, reject) => {
    composer.compile().build((err, message) => (err ? reject(err) : resolve(message)));
  });
}

export interface InboundRaw {
  uid: number;
  source: Buffer;
}

export interface ConnectionTestResult {
  imap: 'pass' | 'fail';
  smtp: 'pass' | 'fail';
  folders?: number;
  draftsFolder?: boolean;
  sentFolder?: boolean;
}

export type SmtpErrorKind = 'rate_limit' | 'network' | 'rejected_recipient' | 'auth' | 'other';

export interface MailTransport {
  readonly mode: 'dry_run' | 'live';
  /** APPEND to the special-use \Drafts mailbox with the \Draft flag. Returns the UID (null in dry run). */
  appendDraft(raw: Buffer): Promise<number | null>;
  /** APPEND a copy of a sent message to the special-use \Sent mailbox with \Seen. */
  appendSent(raw: Buffer): Promise<void>;
  /** Delete OUR draft from the Drafts mailbox by UID. Never touches INBOX. */
  deleteDraft(uid: number): Promise<void>;
  send(
    envelope: { from: string; to: string },
    raw: Buffer,
  ): Promise<{ accepted: string[]; response: string }>;
  /** Read-only fetch of new INBOX messages after lastUid. */
  fetchInbox(
    lastUid: number,
    uidValidity: string | null,
  ): Promise<{ uidValidity: string; messages: InboundRaw[]; resetTo?: number }>;
  testConnection(): Promise<ConnectionTestResult>;
}

export function titanConfigured(env: Pick<ServerEnv, 'TITAN_USER' | 'TITAN_PASSWORD'>): boolean {
  return !!env.TITAN_USER && !!env.TITAN_PASSWORD;
}

function imapClient(env: ServerEnv): ImapFlow {
  return new ImapFlow({
    host: TITAN.imapHost,
    port: TITAN.imapPort,
    secure: true,
    auth: { user: env.TITAN_USER ?? '', pass: env.TITAN_PASSWORD ?? '' },
    logger: false,
    socketTimeout: 60_000,
  });
}

async function withImap<T>(env: ServerEnv, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  if (!titanConfigured(env)) throw new Error('TITAN_USER / TITAN_PASSWORD are not set');
  const client = imapClient(env);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

async function specialUsePath(
  client: ImapFlow,
  use: '\\Drafts' | '\\Sent',
  fallback: string,
): Promise<string> {
  const list = await client.list();
  const found =
    list.find((f) => f.specialUse === use) ??
    list.find((f) => f.path.toLowerCase() === fallback.toLowerCase());
  return found?.path ?? fallback;
}

function assertNotInbox(path: string) {
  if (path.toUpperCase() === 'INBOX') throw new Error('Refusing to modify INBOX (safety rule 7)');
}

function smtpTransport(env: ServerEnv) {
  return nodemailer.createTransport({
    host: TITAN.smtpHost,
    port: TITAN.smtpPort,
    secure: true,
    auth: { user: env.TITAN_USER ?? '', pass: env.TITAN_PASSWORD ?? '' },
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
  });
}

async function fetchInboxReadOnly(env: ServerEnv, lastUid: number, uidValidity: string | null) {
  return withImap(env, async (client) => {
    const mailbox = await client.mailboxOpen('INBOX', { readOnly: true });
    const currentValidity = String(mailbox.uidValidity);
    // If UIDVALIDITY changed, UIDs were renumbered: restart from the current UIDNEXT to avoid re-processing history.
    if (uidValidity && uidValidity !== currentValidity) {
      return {
        uidValidity: currentValidity,
        messages: [],
        resetTo: Math.max(0, Number(mailbox.uidNext ?? 1) - 1),
      };
    }
    const messages: InboundRaw[] = [];
    if (mailbox.exists > 0) {
      for await (const msg of client.fetch(`${lastUid + 1}:*`, { uid: true, source: true }, { uid: true })) {
        if (msg.uid > lastUid && msg.source) messages.push({ uid: msg.uid, source: msg.source });
        if (messages.length >= 200) break;
      }
    }
    return { uidValidity: currentValidity, messages };
  });
}

class LiveTitanTransport implements MailTransport {
  readonly mode = 'live' as const;
  constructor(
    private readonly env: ServerEnv,
    private readonly logger: Logger,
  ) {}

  appendDraft(raw: Buffer): Promise<number | null> {
    return withImap(this.env, async (client) => {
      const path = await specialUsePath(client, '\\Drafts', 'Drafts');
      assertNotInbox(path);
      const res = await client.append(path, raw, ['\\Draft']);
      return res && typeof res === 'object' && 'uid' in res && res.uid ? Number(res.uid) : null;
    });
  }

  async appendSent(raw: Buffer): Promise<void> {
    await withImap(this.env, async (client) => {
      const path = await specialUsePath(client, '\\Sent', 'Sent');
      assertNotInbox(path);
      await client.append(path, raw, ['\\Seen']);
    });
  }

  async deleteDraft(uid: number): Promise<void> {
    await withImap(this.env, async (client) => {
      const path = await specialUsePath(client, '\\Drafts', 'Drafts');
      assertNotInbox(path);
      const lock = await client.getMailboxLock(path);
      try {
        await client.messageDelete(String(uid), { uid: true });
      } finally {
        lock.release();
      }
    });
  }

  async send(envelope: { from: string; to: string }, raw: Buffer) {
    const transport = smtpTransport(this.env);
    try {
      const info = await transport.sendMail({ envelope, raw });
      return { accepted: (info.accepted ?? []).map(String), response: String(info.response ?? '') };
    } finally {
      transport.close();
    }
  }

  fetchInbox(lastUid: number, uidValidity: string | null) {
    return fetchInboxReadOnly(this.env, lastUid, uidValidity);
  }

  testConnection(): Promise<ConnectionTestResult> {
    return testTitanConnection(this.env, this.logger);
  }
}

/** dry_run: SMTP replaced by a logger, IMAP writes skipped and logged. IMAP reads are allowed (read-only). */
class DryRunTransport implements MailTransport {
  readonly mode = 'dry_run' as const;
  constructor(
    private readonly env: ServerEnv,
    private readonly logger: Logger,
  ) {}

  async appendDraft(raw: Buffer): Promise<number | null> {
    this.logger.info({ bytes: raw.length }, '[dry_run] IMAP APPEND to Drafts skipped');
    return null;
  }
  async appendSent(raw: Buffer): Promise<void> {
    this.logger.info({ bytes: raw.length }, '[dry_run] IMAP APPEND to Sent skipped');
  }
  async deleteDraft(uid: number): Promise<void> {
    this.logger.info({ uid }, '[dry_run] IMAP draft delete skipped');
  }
  async send(envelope: { from: string; to: string }, raw: Buffer) {
    this.logger.info({ to: envelope.to, bytes: raw.length }, '[dry_run] SMTP send replaced by logger');
    return { accepted: [envelope.to], response: '250 dry-run (not sent)' };
  }
  async fetchInbox(lastUid: number, uidValidity: string | null) {
    if (!titanConfigured(this.env)) return { uidValidity: uidValidity ?? '', messages: [] };
    return fetchInboxReadOnly(this.env, lastUid, uidValidity);
  }
  testConnection(): Promise<ConnectionTestResult> {
    return testTitanConnection(this.env, this.logger);
  }
}

/** IMAP login + folder list and SMTP verify. Returns pass/fail only — never error text that could leak details. */
export async function testTitanConnection(env: ServerEnv, logger: Logger): Promise<ConnectionTestResult> {
  const result: ConnectionTestResult = { imap: 'fail', smtp: 'fail' };
  if (!titanConfigured(env)) return result;
  try {
    await withImap(env, async (client) => {
      const list = await client.list();
      result.folders = list.length;
      result.draftsFolder = list.some(
        (f) => f.specialUse === '\\Drafts' || f.path.toLowerCase() === 'drafts',
      );
      result.sentFolder = list.some((f) => f.specialUse === '\\Sent' || f.path.toLowerCase() === 'sent');
    });
    result.imap = 'pass';
  } catch (err) {
    logger.warn({ code: (err as { code?: string }).code }, 'Titan IMAP test failed');
  }
  const transport = smtpTransport(env);
  try {
    await transport.verify();
    result.smtp = 'pass';
  } catch (err) {
    logger.warn({ code: (err as { code?: string }).code }, 'Titan SMTP test failed');
  } finally {
    transport.close();
  }
  return result;
}

export function createMailTransport(env: ServerEnv, logger: Logger): MailTransport {
  return env.EMAIL_MODE === 'live' ? new LiveTitanTransport(env, logger) : new DryRunTransport(env, logger);
}

/** Classify an SMTP/network error for retry policy. */
export function classifySmtpError(err: unknown): SmtpErrorKind {
  const e = err as {
    code?: string;
    responseCode?: number;
    response?: string;
    message?: string;
    command?: string;
  };
  const code = e?.responseCode ?? 0;
  const text = `${e?.response ?? ''} ${e?.message ?? ''}`.toLowerCase();
  if (
    e?.code === 'EAUTH' ||
    code === 535 ||
    code === 534 ||
    /authentication|auth failed|invalid login/.test(text)
  ) {
    return 'auth';
  }
  if (
    code === 421 ||
    code === 450 ||
    code === 451 ||
    code === 452 ||
    /rate limit|too many|try again later|throttl/.test(text)
  ) {
    return 'rate_limit';
  }
  if (
    [
      'ECONNECTION',
      'ETIMEDOUT',
      'ESOCKET',
      'ECONNRESET',
      'ECONNREFUSED',
      'ENOTFOUND',
      'EAI_AGAIN',
      'EDNS',
    ].includes(e?.code ?? '')
  ) {
    return 'network';
  }
  if (
    e?.code === 'EENVELOPE' ||
    (code >= 550 && code <= 553) ||
    /user unknown|no such user|mailbox unavailable|recipient (address )?rejected|does not exist/.test(text)
  ) {
    return 'rejected_recipient';
  }
  return 'other';
}

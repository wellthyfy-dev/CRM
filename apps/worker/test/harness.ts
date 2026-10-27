import { eq, sql } from 'drizzle-orm';
import type PgBoss from 'pg-boss';
import {
  contacts,
  createLogger,
  emails,
  organisations,
  profiles,
  readServerEnv,
  RecordingPublisher,
  memoryFileStore,
  seed,
  settings,
  type AiProvider,
  type AiResult,
  type ConnectionTestResult,
  type DbHandle,
  type InboundRaw,
  type MailTransport,
} from '@wellthyfy/shared/server';
import { createTestDb } from '@wellthyfy/shared/testing';
import type { AiReplyClassification, AiResearchOutput, FetchedPage } from '@wellthyfy/shared';
import type { WorkerDeps } from '../src/runtime';
import { parseMail } from '../src/lib/parse-mail';

/** Scriptable AI fake: set researchResult / classifyResult to control the next call. */
export class FakeAi implements AiProvider {
  configured = true;
  researchResult: AiResult<AiResearchOutput> | null = null;
  classifyResult: AiReplyClassification = { classification: 'interested', summary: 'Wants a proposal' };
  classifyCalls = 0;
  async research(): Promise<AiResult<AiResearchOutput>> {
    if (!this.researchResult) throw new Error('no fake research result set');
    return this.researchResult;
  }
  async classifyReply(model: string): Promise<AiResult<AiReplyClassification>> {
    this.classifyCalls++;
    return { output: this.classifyResult, model, tokensIn: 100, tokensOut: 20 };
  }
}
export const fakeAi = new FakeAi();
export const fakeSearcher = {
  configured: true,
  calls: [] as string[],
  results: [] as { title: string; link: string; snippet?: string }[],
  async search(q: string) {
    fakeSearcher.calls.push(q);
    return fakeSearcher.results;
  },
};
export const notifications: { subject: string; text: string }[] = [];
export const pages = { value: [] as FetchedPage[] };

export const ADMIN_ID = '00000000-0000-4000-8000-0000000000aa';

/** Records every IMAP/SMTP call. Never touches the network. */
export class FakeTransport implements MailTransport {
  readonly mode = 'dry_run' as const;
  drafts: Buffer[] = [];
  sentCopies: Buffer[] = [];
  deletedDrafts: number[] = [];
  sends: { to: string; raw: Buffer }[] = [];
  inbox: InboundRaw[] = [];
  uidValidity = '1';
  sendError: unknown = null;
  private nextUid = 100;

  async appendDraft(raw: Buffer) {
    this.drafts.push(raw);
    return this.nextUid++;
  }
  async appendSent(raw: Buffer) {
    this.sentCopies.push(raw);
  }
  async deleteDraft(uid: number) {
    this.deletedDrafts.push(uid);
  }
  async send(envelope: { from: string; to: string }, raw: Buffer) {
    if (this.sendError) throw this.sendError;
    this.sends.push({ to: envelope.to, raw });
    return { accepted: [envelope.to], response: '250 OK' };
  }
  async fetchInbox(lastUid: number) {
    return { uidValidity: this.uidValidity, messages: this.inbox.filter((m) => m.uid > lastUid) };
  }
  async testConnection(): Promise<ConnectionTestResult> {
    return { imap: 'pass', smtp: 'pass' };
  }
}

export interface Harness {
  handle: DbHandle;
  deps: WorkerDeps;
  mail: FakeTransport;
  publisher: RecordingPublisher;
  clock: { now: Date };
}

let shared: DbHandle | null = null;

/** One PGlite database per test file; data tables are truncated and settings reset for each harness. */
async function freshDb(): Promise<DbHandle> {
  if (!shared) {
    shared = await createTestDb();
    return shared;
  }
  await shared.db.execute(
    sql`truncate table activities, replies, proposals, emails, research, contacts, ai_usage, discovery_runs, suppressions, organisations, profiles restart identity cascade`,
  );
  await shared.db.delete(settings);
  await seed(shared.db);
  return shared;
}

export async function createHarness(now: Date): Promise<Harness> {
  const handle = await freshDb();
  await handle.db
    .insert(profiles)
    .values({ id: ADMIN_ID, fullName: 'Admin', role: 'admin', email: 'admin@wellthyfy.in' });
  const mail = new FakeTransport();
  const publisher = new RecordingPublisher();
  const clock = { now };
  const deps: WorkerDeps = {
    db: handle.db,
    env: readServerEnv({
      DATABASE_URL: 'pglite://memory',
      TITAN_USER: 'ceo@wellthyfy.in',
      EMAIL_MODE: 'dry_run',
    }),
    logger: createLogger('worker-test'),
    boss: {} as PgBoss,
    publisher,
    mail,
    verifier: { configured: true, verify: async () => 'valid' },
    ai: fakeAi,
    notifier: { configured: true, send: async (m) => void notifications.push(m) },
    fetchPages: async () => pages.value,
    searcher: fakeSearcher,
    parseMail,
    downloadAttachment: async () => Buffer.from('%PDF-1.4 test'),
    files: memoryFileStore(),
    now: () => clock.now,
    randomGapSeconds: () => 90,
    state: { startedAt: now, lastHeartbeatAt: null, lastJobAt: {} },
  };
  return { handle, deps, mail, publisher, clock };
}

let counter = 0;

/** Organisation + verified contact + email in the given status, approved by ADMIN_ID. */
export async function seedEmail(
  h: Harness,
  opts: {
    status?: 'draft' | 'pending_approval' | 'approved' | 'queued' | 'sent';
    sentAt?: Date;
    contactEmail?: string;
    verified?: boolean;
    optOut?: boolean;
  } = {},
) {
  counter++;
  const { db } = h.handle;
  const [org] = await db
    .insert(organisations)
    .values({
      name: `College ${counter}`,
      orgType: 'college_university',
      segment: 'arts_science',
      domain: `c${counter}.ac.in`,
      stage: 'approved',
    })
    .returning();
  const [contact] = await db
    .insert(contacts)
    .values({
      organisationId: org!.id,
      fullName: `Dr. Contact ${counter}`,
      email: opts.contactEmail ?? `principal${counter}@c${counter}.ac.in`,
      sourceUrl: `https://c${counter}.ac.in/contact`,
      verified: opts.verified ?? true,
      optOut: opts.optOut ?? false,
      emailCheckStatus: 'valid',
      emailCheckedAt: h.clock.now,
    })
    .returning();
  const [email] = await db
    .insert(emails)
    .values({
      organisationId: org!.id,
      contactId: contact!.id,
      subject: `Training Proposal ${counter}`,
      body: `Dear Sir/Madam,\n\nBody ${counter}\n\nIf you'd prefer not to receive further emails from us, simply reply STOP.`,
      status: opts.status ?? 'approved',
      approvedBy: ADMIN_ID,
      approvedAt: h.clock.now,
      sentAt: opts.sentAt ?? null,
      queuedAt: opts.status === 'queued' ? h.clock.now : null,
    })
    .returning();
  await db.update(emails).set({ threadId: email!.id }).where(eq(emails.id, email!.id));
  return { org: org!, contact: contact!, email: { ...email!, threadId: email!.id } };
}

export async function reloadEmail(h: Harness, id: string) {
  const [e] = await h.handle.db.select().from(emails).where(eq(emails.id, id));
  return e!;
}

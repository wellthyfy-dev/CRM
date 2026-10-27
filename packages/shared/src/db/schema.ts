import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgSequence,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  EMAIL_CHECK_STATUSES,
  EMAIL_KINDS,
  EMAIL_STATUSES,
  ORG_SOURCES,
  ORG_TYPES,
  PROGRAMME_AUDIENCES,
  PROPOSAL_STATUSES,
  REPLY_CLASSIFICATIONS,
  ROLES,
  SEGMENTS,
  STAGES,
  TEMPLATE_KINDS,
} from '../constants';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const roleEnum = pgEnum('role', ROLES);
export const orgTypeEnum = pgEnum('org_type', ORG_TYPES);
export const segmentEnum = pgEnum('segment', SEGMENTS);
export const stageEnum = pgEnum('stage', STAGES);
export const orgSourceEnum = pgEnum('org_source', ORG_SOURCES);
export const emailCheckStatusEnum = pgEnum('email_check_status', EMAIL_CHECK_STATUSES);
export const programmeAudienceEnum = pgEnum('programme_audience', PROGRAMME_AUDIENCES);
export const templateKindEnum = pgEnum('template_kind', TEMPLATE_KINDS);
export const emailKindEnum = pgEnum('email_kind', EMAIL_KINDS);
export const emailStatusEnum = pgEnum('email_status', EMAIL_STATUSES);
export const replyClassificationEnum = pgEnum('reply_classification', REPLY_CLASSIFICATIONS);
export const proposalStatusEnum = pgEnum('proposal_status', PROPOSAL_STATUSES);

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => tz('created_at').notNull().defaultNow();
const updatedAt = () =>
  tz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const id = () => uuid('id').primaryKey().defaultRandom();

export const organisationRecordSeq = pgSequence('organisation_record_seq', { startWith: 1 });

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/** One row per Supabase auth user; id = auth.users.id. */
export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(),
  email: text('email'),
  fullName: text('full_name').notNull().default(''),
  role: roleEnum('role').notNull().default('viewer'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const programmes = pgTable('programmes', {
  id: id(),
  name: text('name').notNull(),
  audience: programmeAudienceEnum('audience').notNull().default('both'),
  segments: segmentEnum('segments')
    .array()
    .notNull()
    .default(sql`'{}'`),
  modules: text('modules')
    .array()
    .notNull()
    .default(sql`'{}'`),
  durationOptions: text('duration_options')
    .array()
    .notNull()
    .default(sql`'{}'`),
  indicativeFeeMin: numeric('indicative_fee_min', { precision: 12, scale: 2, mode: 'number' }),
  indicativeFeeMax: numeric('indicative_fee_max', { precision: 12, scale: 2, mode: 'number' }),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const organisations = pgTable(
  'organisations',
  {
    id: id(),
    recordId: text('record_id')
      .notNull()
      .default(sql`'WF-' || lpad(nextval('organisation_record_seq')::text, 6, '0')`),
    name: text('name').notNull(),
    orgType: orgTypeEnum('org_type').notNull(),
    segment: segmentEnum('segment').notNull(),
    industryDepartment: text('industry_department'),
    city: text('city'),
    district: text('district'),
    state: text('state'),
    website: text('website'),
    domain: text('domain'),
    stage: stageEnum('stage').notNull().default('research_needed'),
    ownerId: uuid('owner_id').references(() => profiles.id, { onDelete: 'set null' }),
    doNotContact: boolean('do_not_contact').notNull().default(false),
    lostReason: text('lost_reason'),
    nextFollowUpAt: tz('next_follow_up_at'),
    notes: text('notes'),
    source: orgSourceEnum('source').notNull().default('manual'),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('organisations_record_id_key').on(t.recordId),
    uniqueIndex('organisations_domain_key').on(t.domain),
    index('organisations_stage_idx').on(t.stage),
    index('organisations_segment_idx').on(t.segment),
    index('organisations_owner_idx').on(t.ownerId),
    index('organisations_next_follow_up_idx').on(t.nextFollowUpAt),
    index('organisations_city_idx').on(t.city),
    index('organisations_state_idx').on(t.state),
    index('organisations_name_lower_idx').on(sql`lower(${t.name})`),
  ],
);

export const contacts = pgTable(
  'contacts',
  {
    id: id(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull().default(''),
    designation: text('designation'),
    /** Lowercased. Nullable only after a data-protection anonymisation. */
    email: text('email'),
    phone: text('phone'),
    sourceUrl: text('source_url'),
    verified: boolean('verified').notNull().default(false),
    verifiedBy: uuid('verified_by').references(() => profiles.id, { onDelete: 'set null' }),
    verifiedAt: tz('verified_at'),
    optOut: boolean('opt_out').notNull().default(false),
    optOutAt: tz('opt_out_at'),
    emailCheckStatus: emailCheckStatusEnum('email_check_status').notNull().default('unknown'),
    emailCheckedAt: tz('email_checked_at'),
    isPrimary: boolean('is_primary').notNull().default(false),
    /** true for contacts suggested by AI research (always start unverified). */
    aiSuggested: boolean('ai_suggested').notNull().default(false),
    anonymisedAt: tz('anonymised_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('contacts_email_key').on(t.email),
    index('contacts_organisation_idx').on(t.organisationId),
  ],
);

/** Permanent opt-out list keyed by SHA-256 of the lowercased address, so opt-outs survive anonymisation. */
export const suppressions = pgTable(
  'suppressions',
  {
    id: id(),
    emailHash: text('email_hash').notNull(),
    reason: text('reason').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('suppressions_email_hash_key').on(t.emailHash)],
);

export interface SourcePage {
  url: string;
  title?: string;
}

export const research = pgTable(
  'research',
  {
    id: id(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    websiteEvidence: text('website_evidence'),
    trainingNeed: text('training_need'),
    recommendedProgrammeId: uuid('recommended_programme_id').references(() => programmes.id, {
      onDelete: 'set null',
    }),
    durationFormat: text('duration_format'),
    personalisationNote: text('personalisation_note'),
    sourcePages: jsonb('source_pages')
      .$type<SourcePage[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** AI output extras (evidence quotes, candidate contacts, draft, confidence). */
    aiOutput: jsonb('ai_output').$type<Record<string, unknown> | null>(),
    aiModel: text('ai_model'),
    aiGenerated: boolean('ai_generated').notNull().default(false),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    costInr: numeric('cost_inr', { precision: 12, scale: 4, mode: 'number' }).notNull().default(0),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('research_organisation_idx').on(t.organisationId, t.createdAt)],
);

export const templates = pgTable(
  'templates',
  {
    id: id(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    segments: segmentEnum('segments')
      .array()
      .notNull()
      .default(sql`'{}'`),
    kind: templateKindEnum('kind').notNull().default('first_contact'),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    version: integer('version').notNull().default(1),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('templates_key_key').on(t.key)],
);

/** Immutable history of every template version, so sent emails can always be traced to their wording. */
export const templateVersions = pgTable(
  'template_versions',
  {
    id: id(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('template_versions_template_version_key').on(t.templateId, t.version)],
);

export interface EmailAttachment {
  /** Path inside the Supabase Storage bucket. */
  path: string;
  filename: string;
  contentType: string;
}

export const emails = pgTable(
  'emails',
  {
    id: id(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    templateId: uuid('template_id').references(() => templates.id, { onDelete: 'set null' }),
    templateVersion: integer('template_version'),
    kind: emailKindEnum('kind').notNull().default('first_contact'),
    followUpNo: integer('follow_up_no').notNull().default(0),
    parentEmailId: uuid('parent_email_id').references((): AnyPgColumn => emails.id, { onDelete: 'set null' }),
    /** Root email id of the conversation thread (own id for a first contact). */
    threadId: uuid('thread_id'),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    status: emailStatusEnum('status').notNull().default('draft'),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    submittedBy: uuid('submitted_by').references(() => profiles.id, { onDelete: 'set null' }),
    submittedAt: tz('submitted_at'),
    approvedBy: uuid('approved_by').references(() => profiles.id, { onDelete: 'set null' }),
    approvedAt: tz('approved_at'),
    rejectionReason: text('rejection_reason'),
    gateFailureReason: text('gate_failure_reason'),
    imapDraftUid: integer('imap_draft_uid'),
    messageId: text('message_id'),
    inReplyTo: text('in_reply_to'),
    references: text('references'),
    attachments: jsonb('attachments')
      .$type<EmailAttachment[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    scheduledFor: tz('scheduled_for'),
    queuedAt: tz('queued_at'),
    sentAt: tz('sent_at'),
    sendAttempts: integer('send_attempts').notNull().default(0),
    /** Extra days added to follow-up timing (out-of-office replies shift follow-ups by 7 days). */
    followUpOffsetDays: integer('follow_up_offset_days').notNull().default(0),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('emails_message_id_key').on(t.messageId),
    index('emails_organisation_idx').on(t.organisationId),
    index('emails_contact_sent_idx').on(t.contactId, t.sentAt),
    index('emails_status_idx').on(t.status),
    index('emails_sent_at_idx').on(t.sentAt),
    index('emails_thread_idx').on(t.threadId),
  ],
);

export const replies = pgTable(
  'replies',
  {
    id: id(),
    emailId: uuid('email_id').references(() => emails.id, { onDelete: 'set null' }),
    organisationId: uuid('organisation_id').references(() => organisations.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    fromEmail: text('from_email').notNull(),
    subject: text('subject'),
    snippet: text('snippet'),
    receivedAt: tz('received_at').notNull(),
    messageId: text('message_id'),
    imapUid: integer('imap_uid'),
    classification: replyClassificationEnum('classification').notNull().default('other'),
    summary: text('summary'),
    handled: boolean('handled').notNull().default(false),
    handledBy: uuid('handled_by').references(() => profiles.id, { onDelete: 'set null' }),
    handledAt: tz('handled_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('replies_message_id_key').on(t.messageId),
    index('replies_organisation_idx').on(t.organisationId),
    index('replies_received_idx').on(t.receivedAt),
  ],
);

export const proposals = pgTable(
  'proposals',
  {
    id: id(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    programmeId: uuid('programme_id').references(() => programmes.id, { onDelete: 'set null' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    emailId: uuid('email_id').references(() => emails.id, { onDelete: 'set null' }),
    duration: text('duration'),
    valueInr: numeric('value_inr', { precision: 12, scale: 2, mode: 'number' }),
    notes: text('notes'),
    status: proposalStatusEnum('status').notNull().default('draft'),
    filePath: text('file_path'),
    sentAt: tz('sent_at'),
    decidedAt: tz('decided_at'),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('proposals_organisation_idx').on(t.organisationId)],
);

export const activities = pgTable(
  'activities',
  {
    id: id(),
    organisationId: uuid('organisation_id').references(() => organisations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => profiles.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    index('activities_organisation_idx').on(t.organisationId, t.createdAt),
    index('activities_type_idx').on(t.type, t.createdAt),
  ],
);

/** Single-row settings table (id is always 1). */
export const settings = pgTable('settings', {
  id: integer('id').primaryKey().default(1),
  dailySendCap: integer('daily_send_cap').notNull().default(30),
  hourlySendCap: integer('hourly_send_cap').notNull().default(10),
  sendWindowStart: text('send_window_start').notNull().default('10:00'),
  sendWindowEnd: text('send_window_end').notNull().default('17:00'),
  sendDays: text('send_days')
    .array()
    .notNull()
    .default(sql`'{Mon,Tue,Wed,Thu,Fri,Sat}'`),
  followUp1Days: integer('follow_up_1_days').notNull().default(7),
  followUp2Days: integer('follow_up_2_days').notNull().default(14),
  /** null → AI_MODEL_DEFAULT from env. */
  aiModel: text('ai_model'),
  aiMonthlyLimitInr: numeric('ai_monthly_limit_inr', { precision: 12, scale: 2, mode: 'number' })
    .notNull()
    .default(2000),
  searchMonthlyLimit: integer('search_monthly_limit').notNull().default(500),
  signature: text('signature').notNull().default(''),
  optOutLine: text('opt_out_line').notNull().default(''),
  privacyNoticeUrl: text('privacy_notice_url'),
  imapLastUid: integer('imap_last_uid').notNull().default(0),
  imapUidValidity: text('imap_uid_validity'),
  queuePaused: boolean('queue_paused').notNull().default(false),
  queuePausedUntil: tz('queue_paused_until'),
  queuePauseReason: text('queue_pause_reason'),
  nextSendAfter: tz('next_send_after'),
  updatedAt: updatedAt(),
});

/** Every paid AI call (research, reply classification) for monthly-limit enforcement. */
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: id(),
    purpose: text('purpose').notNull(),
    model: text('model').notNull(),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    costInr: numeric('cost_inr', { precision: 12, scale: 4, mode: 'number' }).notNull().default(0),
    organisationId: uuid('organisation_id').references(() => organisations.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('ai_usage_created_idx').on(t.createdAt)],
);

export interface DiscoveryCandidate {
  name: string;
  website: string;
  domain: string;
  snippet: string;
  query: string;
  existingOrganisationId?: string | null;
  added?: boolean;
}

export const discoveryRuns = pgTable(
  'discovery_runs',
  {
    id: id(),
    query: text('query').notNull(),
    params: jsonb('params')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: text('status').notNull().default('pending'),
    results: jsonb('results')
      .$type<DiscoveryCandidate[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    resultsCount: integer('results_count').notNull().default(0),
    searchesUsed: integer('searches_used').notNull().default(0),
    error: text('error'),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('discovery_runs_created_idx').on(t.createdAt)],
);

export type Profile = typeof profiles.$inferSelect;
export type Organisation = typeof organisations.$inferSelect;
export type NewOrganisation = typeof organisations.$inferInsert;
export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type Research = typeof research.$inferSelect;
export type Programme = typeof programmes.$inferSelect;
export type Template = typeof templates.$inferSelect;
export type Email = typeof emails.$inferSelect;
export type NewEmail = typeof emails.$inferInsert;
export type Reply = typeof replies.$inferSelect;
export type Proposal = typeof proposals.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type DiscoveryRun = typeof discoveryRuns.$inferSelect;

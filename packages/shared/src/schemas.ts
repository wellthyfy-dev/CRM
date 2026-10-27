import { z } from 'zod';
import {
  EMAIL_CHECK_STATUSES,
  EMAIL_STATUSES,
  MANUAL_ACTIVITY_TYPES,
  ORG_SOURCES,
  ORG_TYPES,
  PROGRAMME_AUDIENCES,
  PROPOSAL_STATUSES,
  REPLY_CLASSIFICATIONS,
  ROLES,
  SEGMENTS,
  STAGES,
  TEMPLATE_KINDS,
  WEEKDAYS,
} from './constants';
import { isValidEmailSyntax } from './email';
import { parseHhMm } from './time';

// Request-body schemas shared by the API (validation) and the web app (forms).

const trimmed = (max = 500) => z.string().trim().max(max);
const optionalText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => /^https?:\/\//i.test(v), 'Must start with http:// or https://');
const optionalHttpUrl = z
  .string()
  .trim()
  .max(2000)
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^https?:\/\//i.test(v), 'Must start with http:// or https://');
const emailField = z.string().trim().toLowerCase().refine(isValidEmailSyntax, 'Invalid email address');
const isoDate = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid date');
const hhmm = z.string().refine((v) => !Number.isNaN(parseHhMm(v)), 'Use HH:MM (24h)');

export const roleSchema = z.enum(ROLES);
export const orgTypeSchema = z.enum(ORG_TYPES);
export const segmentSchema = z.enum(SEGMENTS);
export const stageSchema = z.enum(STAGES);

// ---- Organisations ---------------------------------------------------------
export const organisationCreateSchema = z.object({
  name: trimmed(300).min(1, 'Name is required'),
  orgType: orgTypeSchema,
  segment: segmentSchema,
  industryDepartment: optionalText(300),
  city: optionalText(120),
  district: optionalText(120),
  state: optionalText(120),
  website: optionalText(500),
  ownerId: z.string().uuid().nullish(),
  notes: optionalText(10000),
  source: z.enum(ORG_SOURCES).optional(),
  nextFollowUpAt: isoDate.nullish(),
});
export type OrganisationCreate = z.infer<typeof organisationCreateSchema>;

export const organisationUpdateSchema = organisationCreateSchema.partial().extend({
  doNotContact: z.boolean().optional(),
});
export type OrganisationUpdate = z.infer<typeof organisationUpdateSchema>;

export const stageChangeSchema = z
  .object({ stage: stageSchema, lostReason: optionalText(1000) })
  .refine((v) => v.stage !== 'lost' || !!v.lostReason, {
    message: 'A reason is required when marking an organisation as lost',
    path: ['lostReason'],
  });

export const followUpDateSchema = z.object({ nextFollowUpAt: isoDate.nullable() });

const boolQuery = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true'));

export const organisationListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  orgType: orgTypeSchema.optional(),
  segment: segmentSchema.optional(),
  state: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  stage: stageSchema.optional(),
  ownerId: z.string().uuid().optional(),
  verified: boolQuery,
  optOut: boolQuery,
  due: z.enum(['today', 'overdue']).optional(),
  sort: z
    .enum(['name', 'record_id', 'city', 'stage', 'created_at', 'updated_at', 'next_follow_up_at'])
    .default('updated_at'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type OrganisationListQuery = z.infer<typeof organisationListQuerySchema>;

// ---- Contacts --------------------------------------------------------------
export const contactCreateSchema = z.object({
  fullName: trimmed(200).default(''),
  designation: optionalText(200),
  email: emailField.nullish().transform((v) => v ?? null),
  phone: optionalText(50),
  sourceUrl: optionalHttpUrl,
  isPrimary: z.boolean().optional(),
});
export type ContactCreate = z.infer<typeof contactCreateSchema>;
export const contactUpdateSchema = contactCreateSchema.partial();
export type ContactUpdate = z.infer<typeof contactUpdateSchema>;

export const contactVerifySchema = z.object({ sourceUrl: httpUrl.optional() });

// ---- Research --------------------------------------------------------------
export const researchUpsertSchema = z.object({
  websiteEvidence: optionalText(20000),
  trainingNeed: optionalText(5000),
  recommendedProgrammeId: z.string().uuid().nullish(),
  durationFormat: optionalText(300),
  personalisationNote: optionalText(5000),
  sourceUrls: z.array(httpUrl).max(30).default([]),
});
export type ResearchUpsert = z.infer<typeof researchUpsertSchema>;

// ---- Programmes ------------------------------------------------------------
export const programmeSchema = z
  .object({
    name: trimmed(300).min(1),
    audience: z.enum(PROGRAMME_AUDIENCES),
    segments: z.array(segmentSchema).default([]),
    modules: z.array(trimmed(300).min(1)).default([]),
    durationOptions: z.array(trimmed(200).min(1)).default([]),
    indicativeFeeMin: z.number().nonnegative().nullish(),
    indicativeFeeMax: z.number().nonnegative().nullish(),
    active: z.boolean().default(true),
  })
  .refine(
    (v) =>
      v.indicativeFeeMin == null || v.indicativeFeeMax == null || v.indicativeFeeMin <= v.indicativeFeeMax,
    {
      message: 'Minimum fee must not exceed maximum fee',
      path: ['indicativeFeeMax'],
    },
  );
export type ProgrammeInput = z.infer<typeof programmeSchema>;

// ---- Templates -------------------------------------------------------------
export const templateCreateSchema = z.object({
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{3,60}$/, 'Use A–Z, 0–9 and _ (3–60 chars)'),
  name: trimmed(200).min(1),
  segments: z.array(segmentSchema).default([]),
  kind: z.enum(TEMPLATE_KINDS).default('first_contact'),
  subject: trimmed(300).min(1),
  body: z.string().trim().min(1).max(20000),
  active: z.boolean().default(true),
});
export const templateUpdateSchema = templateCreateSchema.omit({ key: true }).partial();
export const templatePreviewSchema = z.object({
  subject: z.string().max(300),
  body: z.string().max(20000),
  organisationId: z.string().uuid(),
  contactId: z.string().uuid().nullish(),
});

// ---- Emails ----------------------------------------------------------------
export const emailCreateSchema = z.object({
  organisationId: z.string().uuid(),
  contactId: z.string().uuid(),
  templateId: z.string().uuid().optional(),
  subject: trimmed(300).optional(),
  body: z.string().max(20000).optional(),
});
export const emailRenderSchema = z.object({
  organisationId: z.string().uuid(),
  contactId: z.string().uuid(),
  templateId: z.string().uuid().optional(),
});
export const emailUpdateSchema = z.object({
  subject: trimmed(300).min(1).optional(),
  body: z.string().trim().min(1).max(20000).optional(),
});
export const emailRejectSchema = z.object({ reason: trimmed(1000).min(1, 'A reason is required') });
export const bulkIdsSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) });
export const emailListQuerySchema = z.object({
  status: z.enum(EMAIL_STATUSES).optional(),
  organisationId: z.string().uuid().optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

// ---- Activities ------------------------------------------------------------
export const activityCreateSchema = z.object({
  type: z.enum(MANUAL_ACTIVITY_TYPES),
  body: trimmed(10000).min(1),
  occurredAt: isoDate.optional(),
});

// ---- Settings --------------------------------------------------------------
export const settingsUpdateSchema = z
  .object({
    dailySendCap: z.number().int().min(0).max(500),
    hourlySendCap: z.number().int().min(0).max(100),
    sendWindowStart: hhmm,
    sendWindowEnd: hhmm,
    sendDays: z.array(z.enum(WEEKDAYS)).min(1),
    followUp1Days: z.number().int().min(1).max(90),
    followUp2Days: z.number().int().min(2).max(180),
    aiModel: z.string().trim().max(100).nullish(),
    aiMonthlyLimitInr: z.number().nonnegative().max(1_000_000),
    searchMonthlyLimit: z.number().int().nonnegative().max(100_000),
    signature: z.string().trim().min(1).max(2000),
    optOutLine: z.string().trim().min(10, 'An opt-out line is required').max(500),
    privacyNoticeUrl: optionalHttpUrl,
  })
  .partial()
  .refine(
    (v) =>
      !v.sendWindowStart || !v.sendWindowEnd || parseHhMm(v.sendWindowStart) < parseHhMm(v.sendWindowEnd),
    { message: 'Window start must be before end', path: ['sendWindowEnd'] },
  )
  .refine((v) => !v.followUp1Days || !v.followUp2Days || v.followUp1Days < v.followUp2Days, {
    message: 'Follow-up 2 must come after follow-up 1',
    path: ['followUp2Days'],
  });
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

// ---- Users -----------------------------------------------------------------
export const userInviteSchema = z.object({
  email: emailField,
  fullName: trimmed(200).min(1),
  role: roleSchema,
});
export const userUpdateSchema = z.object({
  role: roleSchema.optional(),
  active: z.boolean().optional(),
  fullName: trimmed(200).min(1).optional(),
});

// ---- Import ----------------------------------------------------------------
export const importCommitSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(5000),
  /** target field → source column header */
  mapping: z.record(z.string(), z.string()),
  updateExisting: z.boolean().default(true),
});

// ---- Replies ---------------------------------------------------------------
export const replyListQuerySchema = z.object({
  classification: z.enum(REPLY_CLASSIFICATIONS).optional(),
  handled: boolQuery,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export const replyUpdateSchema = z.object({
  handled: z.boolean().optional(),
  classification: z.enum(REPLY_CLASSIFICATIONS).optional(),
});

// ---- Discovery -------------------------------------------------------------
export const discoveryCreateSchema = z.object({
  orgType: orgTypeSchema,
  segment: segmentSchema.optional(),
  state: trimmed(120).default('Tamil Nadu'),
  city: optionalText(120),
  keywords: optionalText(300),
  maxResults: z.number().int().min(1).max(100).default(20),
});
export const discoveryAddSchema = z.object({
  domains: z.array(z.string().min(3).max(300)).min(1).max(100),
  queueResearch: z.boolean().default(false),
});

// ---- Proposals -------------------------------------------------------------
export const proposalCreateSchema = z.object({
  organisationId: z.string().uuid(),
  programmeId: z.string().uuid(),
  contactId: z.string().uuid().nullish(),
  duration: trimmed(300).min(1),
  valueInr: z.number().nonnegative().max(100_000_000),
  notes: optionalText(5000),
});
export const proposalStatusSchema = z.object({ status: z.enum(PROPOSAL_STATUSES) });

// ---- Misc ------------------------------------------------------------------
export const emailCheckStatusSchema = z.enum(EMAIL_CHECK_STATUSES);
export const uuidParam = z.string().uuid();

export const reportQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

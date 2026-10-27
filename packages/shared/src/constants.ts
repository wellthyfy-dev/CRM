// Enum values shared by the database, API validation and the web app.

export const ROLES = ['admin', 'researcher', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const ORG_TYPES = ['college_university', 'company'] as const;
export type OrgType = (typeof ORG_TYPES)[number];

export const COLLEGE_SEGMENTS = ['arts_science', 'engineering', 'mba_commerce', 'other_college'] as const;
export const COMPANY_SEGMENTS = ['fmcg', 'otc', 'pharma', 'startup_b2b', 'other_company'] as const;
export const SEGMENTS = [...COLLEGE_SEGMENTS, ...COMPANY_SEGMENTS] as const;
export type Segment = (typeof SEGMENTS)[number];

export const STAGES = [
  'research_needed',
  'verified',
  'approved',
  'drafted',
  'sent',
  'replied',
  'meeting_scheduled',
  'proposal_sent',
  'training_confirmed',
  'lost',
  'on_hold',
] as const;
export type Stage = (typeof STAGES)[number];

export const ORG_SOURCES = ['manual', 'import', 'discovery'] as const;
export type OrgSource = (typeof ORG_SOURCES)[number];

export const EMAIL_CHECK_STATUSES = ['unknown', 'valid', 'invalid', 'catch_all', 'risky'] as const;
export type EmailCheckStatus = (typeof EMAIL_CHECK_STATUSES)[number];

export const PROGRAMME_AUDIENCES = ['college', 'company', 'both'] as const;
export type ProgrammeAudience = (typeof PROGRAMME_AUDIENCES)[number];

export const TEMPLATE_KINDS = ['first_contact', 'follow_up_1', 'follow_up_2'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

// Emails can also carry a proposal (sent in an existing thread).
export const EMAIL_KINDS = [...TEMPLATE_KINDS, 'proposal'] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export const EMAIL_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'queued',
  'sent',
  'failed',
  'replied',
  'bounced',
  'cancelled',
] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const REPLY_CLASSIFICATIONS = [
  'interested',
  'not_interested',
  'unsubscribe',
  'out_of_office',
  'bounce',
  'other',
] as const;
export type ReplyClassification = (typeof REPLY_CLASSIFICATIONS)[number];

export const PROPOSAL_STATUSES = ['draft', 'sent', 'accepted', 'declined'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const MANUAL_ACTIVITY_TYPES = ['note', 'call', 'meeting'] as const;
export type ManualActivityType = (typeof MANUAL_ACTIVITY_TYPES)[number];

export const TIME_ZONE = 'Asia/Kolkata';

export const SEGMENT_LABELS: Record<Segment, string> = {
  arts_science: 'Arts & Science',
  engineering: 'Engineering',
  mba_commerce: 'MBA / Commerce',
  other_college: 'Other college',
  fmcg: 'FMCG',
  otc: 'OTC',
  pharma: 'Pharma',
  startup_b2b: 'Startup / B2B',
  other_company: 'Other company',
};

export const STAGE_LABELS: Record<Stage, string> = {
  research_needed: 'Research needed',
  verified: 'Verified',
  approved: 'Approved',
  drafted: 'Drafted',
  sent: 'Sent',
  replied: 'Replied',
  meeting_scheduled: 'Meeting scheduled',
  proposal_sent: 'Proposal sent',
  training_confirmed: 'Training confirmed',
  lost: 'Lost',
  on_hold: 'On hold',
};

export const ORG_TYPE_LABELS: Record<OrgType, string> = {
  college_university: 'College / University',
  company: 'Company',
};

export function segmentsForType(orgType: OrgType): readonly Segment[] {
  return orgType === 'college_university' ? COLLEGE_SEGMENTS : COMPANY_SEGMENTS;
}

export function orgTypeForSegment(segment: Segment): OrgType {
  return (COLLEGE_SEGMENTS as readonly string[]).includes(segment) ? 'college_university' : 'company';
}

/** Index of a stage in the forward funnel; lost/on_hold are off-funnel (-1). */
export function stageRank(stage: Stage): number {
  const funnel: Stage[] = [
    'research_needed',
    'verified',
    'approved',
    'drafted',
    'sent',
    'replied',
    'meeting_scheduled',
    'proposal_sent',
    'training_confirmed',
  ];
  return funnel.indexOf(stage);
}

/** Segment playbook: who to target and what to pitch. Used in AI prompts and the UI. */
export const SEGMENT_PLAYBOOK: Record<Segment, { decisionMakers: string[]; pitch: string[] }> = {
  arts_science: {
    decisionMakers: ['Principal', 'Dean', 'Placement Officer', 'Training & Placement Head'],
    pitch: ['employability', 'communication', 'campus-to-corporate', 'business skills'],
  },
  engineering: {
    decisionMakers: ['Principal', 'Dean', 'Placement Officer', 'Training & Placement Head'],
    pitch: ['employability', 'communication', 'campus-to-corporate', 'business skills'],
  },
  other_college: {
    decisionMakers: ['Principal', 'Dean', 'Placement Officer', 'Training & Placement Head'],
    pitch: ['employability', 'communication', 'campus-to-corporate', 'business skills'],
  },
  mba_commerce: {
    decisionMakers: ['Director', 'MBA Head', 'Placement Head'],
    pitch: ['sales', 'marketing', 'negotiation', 'leadership', 'interview readiness'],
  },
  fmcg: {
    decisionMakers: ['HR', 'L&D', 'Sales Training Head', 'Sales Director'],
    pitch: ['frontline sales effectiveness', 'distribution', 'territory management'],
  },
  otc: {
    decisionMakers: ['HR', 'L&D', 'Sales Training Head', 'Sales Director'],
    pitch: ['frontline sales effectiveness', 'distribution', 'territory management'],
  },
  pharma: {
    decisionMakers: ['L&D', 'Sales Training', 'Regional/Zonal Sales leadership'],
    pitch: ['field-force effectiveness', 'coaching', 'customer engagement'],
  },
  startup_b2b: {
    decisionMakers: ['Founder', 'HR', 'Business Head'],
    pitch: ['sales fundamentals', 'business development', 'customer acquisition'],
  },
  other_company: {
    decisionMakers: ['Founder', 'HR', 'Business Head'],
    pitch: ['sales fundamentals', 'business development', 'customer acquisition'],
  },
};

export const SENDER = {
  name: 'Selvaganapathy V.',
  credentials: 'MBA – Marketing | Corporate Trainer & Sales Mentor',
  title: 'CEO, Wellthyfy Lifestyle Ventures Pvt. Ltd.',
  phone: '97519 45999',
  email: 'ceo@wellthyfy.in',
  website: 'https://wellthyfy.in',
  company: 'Wellthyfy Lifestyle Ventures Pvt. Ltd.',
  tagline: '22 Years in Industry. Now Bringing Industry Experience to the Classroom.',
} as const;

export const DEFAULT_SIGNATURE = [
  'Warm regards,',
  `${SENDER.name} | ${SENDER.credentials}`,
  SENDER.title,
  `${SENDER.phone} | ${SENDER.email} | ${SENDER.website}`,
].join('\n');

export const DEFAULT_OPT_OUT_LINE =
  "If you'd prefer not to receive further emails from us, simply reply STOP.";

export const DEFAULT_SETTINGS = {
  dailySendCap: 30,
  hourlySendCap: 10,
  sendWindowStart: '10:00',
  sendWindowEnd: '17:00',
  sendDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as Weekday[],
  followUp1Days: 7,
  followUp2Days: 14,
  aiMonthlyLimitInr: 2000,
  searchMonthlyLimit: 500,
} as const;

export const MAX_FOLLOW_UPS = 2;
export const RECENT_SEND_DAYS = 7;
export const ZEROBOUNCE_MAX_AGE_DAYS = 90;
export const OOO_SHIFT_DAYS = 7;

/** Template keys seeded from the reference workbook. */
export const TEMPLATE_KEYS = {
  collegeGeneral: 'COLLEGE_GENERAL',
  collegeMba: 'COLLEGE_MBA',
  companySales: 'COMPANY_SALES',
  companyStartup: 'COMPANY_STARTUP',
  followUp1: 'FOLLOW_UP_1',
  followUp2: 'FOLLOW_UP_2',
} as const;

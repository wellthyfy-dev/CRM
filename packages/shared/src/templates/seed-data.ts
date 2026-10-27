import type { ProgrammeAudience, Segment, TemplateKind } from '../constants';
import { TEMPLATE_KEYS } from '../constants';

// The four first-contact templates come from the reference workbook's Templates sheet, converted to merge
// fields. Optional lines from the reference script's buildBody_ are included as conditional sections.

export interface SeedTemplate {
  key: string;
  name: string;
  segments: Segment[];
  kind: TemplateKind;
  subject: string;
  body: string;
}

const GREETING = 'Dear {{#contactName}}{{contactName}} {{/contactName}}Sir/Madam,';
const CLOSING = '{{signature}}\n\n{{optOutLine}}';

export const SEED_TEMPLATES: SeedTemplate[] = [
  {
    key: TEMPLATE_KEYS.collegeGeneral,
    name: 'College / University — general',
    segments: ['arts_science', 'engineering', 'other_college'],
    kind: 'first_contact',
    subject: 'Training Proposal | Career Readiness & Employability Skills for Students',
    body: `${GREETING}

Greetings from Wellthyfy Lifestyle Ventures.

I am reaching out to explore a customised training programme for students at {{organisationName}}. With 22+ years of corporate experience in sales, marketing, distribution and team leadership, I aim to help students connect academic learning with workplace expectations.

{{#trainingNeed}}Based on the potential focus area — {{trainingNeed}} — {{/trainingNeed}}Suggested areas include communication and presentation skills, interview readiness, campus-to-corporate transition, career opportunities across industries, business development and leadership.{{#programmeName}} A suitable programme would be "{{programmeName}}".{{/programmeName}} Content and duration can be tailored to departmental priorities, from a one-hour session to a full-day or multi-day programme{{#durationFormat}} ({{durationFormat}}){{/durationFormat}}.

{{#personalisationNote}}A relevant point for your institution: {{personalisationNote}}

{{/personalisationNote}}If relevant to your current plans, I would be pleased to share a detailed proposal.

${CLOSING}`,
  },
  {
    key: TEMPLATE_KEYS.collegeMba,
    name: 'MBA / Commerce',
    segments: ['mba_commerce'],
    kind: 'first_contact',
    subject: 'Training Proposal | Sales, Marketing & Business Readiness for MBA Students',
    body: `${GREETING}

Greetings from Wellthyfy Lifestyle Ventures.

I would like to propose a practical, industry-oriented session for {{organisationName}}, focused on how sales, marketing and business development work in real organisations.

{{#trainingNeed}}Based on the potential focus area — {{trainingNeed}} — {{/trainingNeed}}Possible modules include sales career opportunities, customer understanding, communication, negotiation, distribution and channel management, interview readiness and leadership.{{#programmeName}} A suitable programme would be "{{programmeName}}".{{/programmeName}} We can customise the session for MBA/Commerce students and offer one-hour, half-day, full-day or multi-day formats{{#durationFormat}} ({{durationFormat}}){{/durationFormat}}.

{{#personalisationNote}}A relevant point for your institution: {{personalisationNote}}

{{/personalisationNote}}May I share a detailed proposal for your consideration?

${CLOSING}`,
  },
  {
    key: TEMPLATE_KEYS.companySales,
    name: 'Company — FMCG / OTC / Pharma sales teams',
    segments: ['fmcg', 'otc', 'pharma'],
    kind: 'first_contact',
    subject: 'Customised Sales Training Proposal | {{organisationName}}',
    body: `${GREETING}

Greetings from Wellthyfy Lifestyle Ventures.

I am writing to explore customised sales capability-building programmes for {{organisationName}}. My experience spans frontline sales, territory management, distribution development, sales planning and team leadership across FMCG, consumer healthcare and pharma-related businesses.

{{#trainingNeed}}Based on the potential focus area — {{trainingNeed}} — {{/trainingNeed}}Possible modules include frontline sales effectiveness, territory and beat planning, distributor management, customer engagement, sales coaching, execution discipline and mid-level manager development.{{#programmeName}} A suitable programme would be "{{programmeName}}".{{/programmeName}} Programmes can be delivered as a one-day workshop, multi-day intervention or contract-based training engagement{{#durationFormat}} ({{durationFormat}}){{/durationFormat}}, tailored to your business priorities.

{{#personalisationNote}}A relevant point for your organisation: {{personalisationNote}}

{{/personalisationNote}}If useful, I would welcome a short discussion to understand your training needs and suggest a suitable format.

${CLOSING}`,
  },
  {
    key: TEMPLATE_KEYS.companyStartup,
    name: 'Company — Startup / B2B / Services',
    segments: ['startup_b2b', 'other_company'],
    kind: 'first_contact',
    subject: 'Customised Sales & Business Development Training | {{organisationName}}',
    body: `${GREETING}

Greetings from Wellthyfy Lifestyle Ventures.

I would like to explore a practical training programme for {{organisationName}} focused on building sales and business-development capability. {{#trainingNeed}}Based on the potential focus area — {{trainingNeed}} — possible{{/trainingNeed}}{{^trainingNeed}}Possible{{/trainingNeed}} topics include customer discovery, value proposition, lead qualification, consultative selling, follow-up discipline, negotiation and team leadership.{{#programmeName}} A suitable programme would be "{{programmeName}}".{{/programmeName}}

The programme can be tailored to your product, target customers and team maturity, and delivered as a one-day workshop, multi-day programme or contract-based engagement{{#durationFormat}} ({{durationFormat}}){{/durationFormat}}.

{{#personalisationNote}}A relevant point for your organisation: {{personalisationNote}}

{{/personalisationNote}}Would you be open to a brief discussion about your priorities?

${CLOSING}`,
  },
  {
    key: TEMPLATE_KEYS.followUp1,
    name: 'Follow-up 1 — polite reminder',
    segments: [],
    kind: 'follow_up_1',
    subject: 'Re: {{organisationName}} — training proposal',
    body: `${GREETING}

I hope you are doing well. I am following up on my earlier email about a customised training programme for {{organisationName}}{{#programmeName}} ("{{programmeName}}"){{/programmeName}}.

I understand you have many priorities. If this is of interest, I would be glad to have a short call at a time convenient to you, or simply share a detailed proposal by email.

${CLOSING}`,
  },
  {
    key: TEMPLATE_KEYS.followUp2,
    name: 'Follow-up 2 — final check-in',
    segments: [],
    kind: 'follow_up_2',
    subject: 'Re: {{organisationName}} — training proposal',
    body: `${GREETING}

I wanted to check in one last time regarding a training programme for {{organisationName}}. If the timing is not right, no problem at all — I will not follow up further on this.

Should training become a priority later, I would be happy to help.

${CLOSING}`,
  },
];

export interface SeedProgramme {
  name: string;
  audience: ProgrammeAudience;
  segments: Segment[];
  modules: string[];
  durationOptions: string[];
  indicativeFeeMin: number;
  indicativeFeeMax: number;
}

export const SEED_PROGRAMMES: SeedProgramme[] = [
  {
    name: 'SAMPLE – edit me: Campus to Career – Employability & Communication Skills',
    audience: 'college',
    segments: ['arts_science', 'engineering', 'other_college'],
    modules: [
      'Communication and presentation skills',
      'Interview readiness',
      'Campus-to-corporate transition',
      'Career opportunities across industries',
    ],
    durationOptions: ['One-hour guest session', 'Half-day workshop', 'Full-day workshop'],
    indicativeFeeMin: 10000,
    indicativeFeeMax: 40000,
  },
  {
    name: 'SAMPLE – edit me: Sales, Marketing & Business Readiness for MBA Students',
    audience: 'college',
    segments: ['mba_commerce'],
    modules: ['Sales careers', 'Customer understanding', 'Negotiation', 'Channel management', 'Leadership'],
    durationOptions: ['Half-day', 'Full-day', 'Multi-day programme'],
    indicativeFeeMin: 15000,
    indicativeFeeMax: 60000,
  },
  {
    name: 'SAMPLE – edit me: Frontline Sales Effectiveness & Distribution Management',
    audience: 'company',
    segments: ['fmcg', 'otc'],
    modules: [
      'Frontline sales effectiveness',
      'Territory and beat planning',
      'Distributor management',
      'Sales coaching',
    ],
    durationOptions: ['One-day workshop', 'Multi-day intervention', 'Contract-based engagement'],
    indicativeFeeMin: 50000,
    indicativeFeeMax: 200000,
  },
  {
    name: 'SAMPLE – edit me: Field-Force Effectiveness for Pharma Teams',
    audience: 'company',
    segments: ['pharma'],
    modules: ['Doctor/customer engagement', 'Field coaching', 'Territory planning', 'Execution discipline'],
    durationOptions: ['One-day workshop', 'Multi-day intervention'],
    indicativeFeeMin: 50000,
    indicativeFeeMax: 200000,
  },
  {
    name: 'SAMPLE – edit me: Sales Fundamentals & Business Development for Startups',
    audience: 'company',
    segments: ['startup_b2b', 'other_company'],
    modules: ['Customer discovery', 'Lead qualification', 'Consultative selling', 'Follow-up discipline'],
    durationOptions: ['One-day workshop', 'Multi-day programme'],
    indicativeFeeMin: 30000,
    indicativeFeeMax: 120000,
  },
];

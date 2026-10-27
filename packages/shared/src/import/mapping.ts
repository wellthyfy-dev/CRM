import type { OrgType, Segment, Stage } from '../constants';
import { isHttpUrl, isValidEmailSyntax, normaliseDomain, normaliseEmail, normaliseWebsite } from '../email';
import { istWallClockToUtc } from '../time';

// Import of the reference workbook's Organisations sheet (26 columns) and similar CSV files.
// See REFERENCE_NOTES.md §1 for the column → database mapping.

export const IMPORT_FIELDS = [
  'recordId',
  'name',
  'orgType',
  'segment',
  'industryDepartment',
  'city',
  'district',
  'state',
  'website',
  'contactName',
  'designation',
  'email',
  'phone',
  'sourceUrl',
  'contactVerified',
  'trainingNeed',
  'recommendedProgramme',
  'durationFormat',
  'personalisationNote',
  'emailSubject',
  'emailBody',
  'approvalStatus',
  'draftCreated',
  'draftCreatedAt',
  'outreachStatus',
  'lastContactDate',
  'followUpDate',
  'notes',
  'optOut',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  recordId: 'Record ID',
  name: 'Organisation name *',
  orgType: 'Organisation type *',
  segment: 'Segment',
  industryDepartment: 'Industry / Department',
  city: 'City',
  district: 'District',
  state: 'State',
  website: 'Official website',
  contactName: 'Contact person',
  designation: 'Designation',
  email: 'Official email',
  phone: 'Phone',
  sourceUrl: 'Contact source URL',
  contactVerified: 'Contact verified (YES/NO)',
  trainingNeed: 'Training need / website evidence',
  recommendedProgramme: 'Recommended programme',
  durationFormat: 'Duration / format',
  personalisationNote: 'Personalisation note',
  emailSubject: 'Email subject',
  emailBody: 'Email body override',
  approvalStatus: 'Approval status',
  draftCreated: 'Draft created?',
  draftCreatedAt: 'Draft created at',
  outreachStatus: 'Outreach status',
  lastContactDate: 'Last contact date',
  followUpDate: 'Follow-up date',
  notes: 'Reply / notes',
  optOut: 'Opt-out (YES/NO)',
};

/** Exact headers of the reference workbook (26 columns) → import field. */
export const REFERENCE_COLUMNS: Record<string, ImportField> = {
  'Record ID': 'recordId',
  'Organisation Name': 'name',
  'Organisation Type': 'orgType',
  'Industry / Department': 'industryDepartment',
  City: 'city',
  State: 'state',
  'Official Website': 'website',
  'Contact Person': 'contactName',
  Designation: 'designation',
  'Official Email': 'email',
  'Contact Source URL': 'sourceUrl',
  'Contact Verified (YES/NO)': 'contactVerified',
  'Likely Training Need / Website Evidence': 'trainingNeed',
  'Recommended Programme': 'recommendedProgramme',
  'Duration / Format': 'durationFormat',
  'Personalisation Note': 'personalisationNote',
  'Email Subject': 'emailSubject',
  'Email Body Override (optional)': 'emailBody',
  'Approval Status': 'approvalStatus',
  'Draft Created?': 'draftCreated',
  'Draft Created At': 'draftCreatedAt',
  'Outreach Status': 'outreachStatus',
  'Last Contact Date': 'lastContactDate',
  'Follow-up Date': 'followUpDate',
  'Reply / Notes': 'notes',
  'Opt-out? (YES/NO)': 'optOut',
};

const ALIASES: Partial<Record<ImportField, string[]>> = {
  name: [
    'organisation',
    'organization name',
    'organisation name',
    'name',
    'college',
    'company',
    'institution',
  ],
  orgType: ['organisation type', 'organization type', 'type'],
  segment: ['segment'],
  industryDepartment: ['industry', 'department', 'industry / department', 'sector'],
  district: ['district'],
  website: ['website', 'official website', 'url', 'site'],
  contactName: ['contact person', 'contact name', 'contact'],
  email: ['email', 'official email', 'email address', 'e-mail'],
  phone: ['phone', 'mobile', 'phone number'],
  sourceUrl: ['contact source url', 'source url', 'source'],
  notes: ['notes', 'reply / notes', 'remarks'],
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Pre-fill the column-mapping screen: exact reference headers first, then loose aliases. */
export function suggestMapping(headers: string[]): Partial<Record<ImportField, string>> {
  const mapping: Partial<Record<ImportField, string>> = {};
  for (const h of headers) {
    const field = REFERENCE_COLUMNS[h.trim()];
    if (field && !mapping[field]) mapping[field] = h;
  }
  for (const field of IMPORT_FIELDS) {
    if (mapping[field]) continue;
    const aliases = [...(ALIASES[field] ?? []), IMPORT_FIELD_LABELS[field].replace(/\s*\*$/, '')].map(norm);
    const hit = headers.find((h) => aliases.includes(norm(h)) && !Object.values(mapping).includes(h));
    if (hit) mapping[field] = hit;
  }
  return mapping;
}

export function mapOrgType(value: string | null | undefined): OrgType | null {
  const v = (value ?? '').toLowerCase();
  if (!v.trim()) return null;
  if (/college|university|institut|school|academy|campus/.test(v)) return 'college_university';
  if (/company|corporate|business|firm|pvt|ltd|startup/.test(v)) return 'company';
  return null;
}

/** Guess the segment from Industry / Department + name (see REFERENCE_NOTES.md §1.1). */
export function guessSegment(orgType: OrgType, ...texts: (string | null | undefined)[]): Segment {
  const t = texts.filter(Boolean).join(' ').toLowerCase();
  if (orgType === 'college_university') {
    if (/\bmba\b|commerce|management|business school|b\.?\s?com\b|\bbba\b|pgdm/.test(t))
      return 'mba_commerce';
    if (/engineering|technology|polytechnic|institute of tech/.test(t)) return 'engineering';
    if (/\barts?\b|science/.test(t)) return 'arts_science';
    return 'other_college';
  }
  if (/fmcg|consumer goods/.test(t)) return 'fmcg';
  if (/\botc\b|consumer health/.test(t)) return 'otc';
  if (/pharma/.test(t)) return 'pharma';
  if (/startup|start-up|\bb2b\b|saas|services|software/.test(t)) return 'startup_b2b';
  return 'other_company';
}

const SEGMENT_WORDS: Record<string, Segment> = {
  'arts science': 'arts_science',
  'arts & science': 'arts_science',
  engineering: 'engineering',
  mba: 'mba_commerce',
  'mba commerce': 'mba_commerce',
  commerce: 'mba_commerce',
  fmcg: 'fmcg',
  otc: 'otc',
  pharma: 'pharma',
  startup: 'startup_b2b',
  'startup b2b': 'startup_b2b',
  b2b: 'startup_b2b',
};

const OUTREACH_STAGE: Record<string, Stage> = {
  'research needed': 'research_needed',
  'draft created': 'drafted',
  sent: 'sent',
  replied: 'replied',
  'meeting scheduled': 'meeting_scheduled',
  'proposal submitted': 'proposal_sent',
  'training confirmed': 'training_confirmed',
  'no response': 'sent',
  'opted out': 'lost',
};

export function yes(value: unknown): boolean {
  return /^(yes|y|true|1)$/i.test(String(value ?? '').trim());
}

/** Parse Date objects, ISO strings, dd/mm/yyyy (Indian format) and Excel serial numbers as IST dates. */
export function parseImportDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const ms = Math.round((value - 25569) * 86400000);
    const d = new Date(ms);
    return istWallClockToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = String(value).trim();
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (dmy) return istWallClockToUtc(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (ymd) return istWallClockToUtc(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface TransformedRow {
  rowNumber: number;
  skip?: string;
  warnings: string[];
  recordId: string | null;
  organisation: {
    name: string;
    orgType: OrgType;
    segment: Segment;
    industryDepartment: string | null;
    city: string | null;
    district: string | null;
    state: string | null;
    website: string | null;
    domain: string | null;
    stage: Stage;
    doNotContact: boolean;
    lostReason: string | null;
    nextFollowUpAt: Date | null;
    notes: string | null;
  };
  contact: {
    fullName: string;
    designation: string | null;
    email: string | null;
    phone: string | null;
    sourceUrl: string | null;
    verified: boolean;
    optOut: boolean;
  } | null;
  research: {
    trainingNeed: string | null;
    websiteEvidence: string | null;
    recommendedProgramme: string | null;
    durationFormat: string | null;
    personalisationNote: string | null;
  } | null;
  emailDraft: { subject: string | null; body: string | null } | null;
  legacy: {
    approvalStatus: string | null;
    draftCreated: boolean;
    draftCreatedAt: string | null;
    outreachStatus: string | null;
    lastContactDate: Date | null;
  };
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = (value instanceof Date ? value.toISOString() : String(value)).trim();
  return s ? s : null;
}

/** Turn one spreadsheet row into normalised records. Pure — the API applies it to the database. */
export function transformRow(
  row: Record<string, unknown>,
  mapping: Partial<Record<ImportField, string>>,
  rowNumber: number,
): TransformedRow {
  const get = (f: ImportField): unknown => {
    const col = mapping[f];
    return col ? row[col] : undefined;
  };
  const warnings: string[] = [];
  const recordId = text(get('recordId'));
  const name = text(get('name')) ?? '';
  const base = { rowNumber, warnings, recordId };

  const empty = (skip: string): TransformedRow => ({
    ...base,
    skip,
    organisation: {
      name,
      orgType: 'company',
      segment: 'other_company',
      industryDepartment: null,
      city: null,
      district: null,
      state: null,
      website: null,
      domain: null,
      stage: 'research_needed',
      doNotContact: false,
      lostReason: null,
      nextFollowUpAt: null,
      notes: null,
    },
    contact: null,
    research: null,
    emailDraft: null,
    legacy: {
      approvalStatus: null,
      draftCreated: false,
      draftCreatedAt: null,
      outreachStatus: null,
      lastContactDate: null,
    },
  });

  if (recordId && recordId.toUpperCase().startsWith('SAMPLE-')) return empty('SAMPLE- placeholder row');
  if (!name) return empty('Missing organisation name');
  const orgType = mapOrgType(text(get('orgType')));
  if (!orgType) return empty(`Unknown organisation type "${text(get('orgType')) ?? ''}"`);

  const industry = text(get('industryDepartment'));
  const segmentText = norm(text(get('segment')) ?? '');
  const segment: Segment = SEGMENT_WORDS[segmentText] ?? guessSegment(orgType, industry, name);

  const website = normaliseWebsite(text(get('website')));
  const domain = normaliseDomain(website);
  if (website && !domain) warnings.push(`Could not read a domain from website "${website}"`);

  // Contact
  const rawEmail = text(get('email'));
  let email: string | null = rawEmail ? normaliseEmail(rawEmail) : null;
  if (email && !isValidEmailSyntax(email)) {
    warnings.push(`Invalid email "${rawEmail}" ignored`);
    email = null;
  }
  const sourceUrl = text(get('sourceUrl'));
  const contactName = text(get('contactName'));
  let verified = yes(get('contactVerified'));
  if (verified && !isHttpUrl(sourceUrl)) {
    warnings.push('Marked verified but source URL is not http(s); imported as unverified');
    verified = false;
  }
  if (verified && !email) verified = false;
  const outreach = text(get('outreachStatus'));
  const outreachKey = outreach?.toLowerCase().trim() ?? '';
  const optOut = yes(get('optOut')) || outreachKey === 'opted out';
  const contact =
    email || contactName
      ? {
          fullName: contactName ?? '',
          designation: text(get('designation')),
          email,
          phone: text(get('phone')),
          sourceUrl: isHttpUrl(sourceUrl) ? sourceUrl : null,
          verified,
          optOut,
        }
      : null;

  // Stage
  const approval = text(get('approvalStatus'));
  const approvalKey = approval?.toUpperCase().trim() ?? '';
  let stage: Stage = OUTREACH_STAGE[outreachKey] ?? 'research_needed';
  if (outreach && !OUTREACH_STAGE[outreachKey]) warnings.push(`Unknown outreach status "${outreach}"`);
  if (stage === 'research_needed') {
    if (approvalKey === 'APPROVED FOR DRAFT') stage = 'approved';
    else if (contact?.verified) stage = 'verified';
  }

  const trainingNeed = text(get('trainingNeed'));
  const recommendedProgramme = text(get('recommendedProgramme'));
  const durationFormat = text(get('durationFormat'));
  const personalisationNote = text(get('personalisationNote'));
  const research =
    trainingNeed || recommendedProgramme || durationFormat || personalisationNote
      ? {
          trainingNeed,
          websiteEvidence: trainingNeed,
          recommendedProgramme,
          durationFormat,
          personalisationNote,
        }
      : null;

  const subject = text(get('emailSubject'));
  const body = text(get('emailBody'));
  const followUpRaw = get('followUpDate');
  const nextFollowUpAt = parseImportDate(followUpRaw);
  if (text(followUpRaw) && !nextFollowUpAt) warnings.push(`Unreadable follow-up date "${text(followUpRaw)}"`);

  return {
    ...base,
    organisation: {
      name,
      orgType,
      segment,
      industryDepartment: industry,
      city: text(get('city')),
      district: text(get('district')),
      state: text(get('state')),
      website,
      domain,
      stage,
      doNotContact: approvalKey === 'DO NOT CONTACT',
      lostReason: outreachKey === 'opted out' ? 'Opted out' : null,
      nextFollowUpAt,
      notes: text(get('notes')),
    },
    contact,
    research,
    emailDraft: contact?.email && (subject || body) ? { subject, body } : null,
    legacy: {
      approvalStatus: approval,
      draftCreated: yes(get('draftCreated')),
      draftCreatedAt: text(get('draftCreatedAt')),
      outreachStatus: outreach,
      lastContactDate: parseImportDate(get('lastContactDate')),
    },
  };
}

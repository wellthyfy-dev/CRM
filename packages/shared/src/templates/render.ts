import type { Segment } from '../constants';
import { TEMPLATE_KEYS } from '../constants';

export const MERGE_FIELDS = [
  'contactName',
  'organisationName',
  'designation',
  'programmeName',
  'durationFormat',
  'trainingNeed',
  'personalisationNote',
  'signature',
  'optOutLine',
] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];
export type MergeVars = Partial<Record<MergeField, string | null | undefined>>;

export const MERGE_FIELD_LABELS: Record<MergeField, string> = {
  contactName: 'Contact name',
  organisationName: 'Organisation name',
  designation: 'Designation',
  programmeName: 'Programme name',
  durationFormat: 'Duration / format',
  trainingNeed: 'Training need',
  personalisationNote: 'Personalisation note',
  signature: 'Signature',
  optOutLine: 'Opt-out line',
};

const SECTION_RE = /\{\{([#^])\s*(\w+)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/g;
const VAR_RE = /\{\{\s*(\w+)\s*\}\}/g;

function present(v: string | null | undefined): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Minimal mustache-style renderer:
 *  {{field}}                — value (empty string when missing)
 *  {{#field}}…{{/field}}    — rendered only when field has a value
 *  {{^field}}…{{/field}}    — rendered only when field is empty
 * Unknown fields render empty. Runs of blank lines left by empty sections collapse to one.
 */
export function renderTemplate(template: string, vars: MergeVars): string {
  const lookup = (key: string) => (vars as Record<string, string | null | undefined>)[key];
  let out = template;
  // Sections may nest one level (e.g. a field inside its own section), so loop until stable.
  for (let i = 0; i < 5; i++) {
    const next = out.replace(SECTION_RE, (_m, kind: string, key: string, inner: string) => {
      const has = present(lookup(key));
      return (kind === '#' ? has : !has) ? inner : '';
    });
    if (next === out) break;
    out = next;
  }
  out = out.replace(VAR_RE, (_m, key: string) => {
    const v = lookup(key);
    return present(v) ? v.trim() : '';
  });
  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Merge fields referenced by a template (for editor validation / hints). */
export function findMergeFields(template: string): string[] {
  const found = new Set<string>();
  for (const m of template.matchAll(/\{\{[#^/]?\s*(\w+)\s*\}\}/g)) if (m[1]) found.add(m[1]);
  return [...found];
}

export function unknownMergeFields(template: string): string[] {
  return findMergeFields(template).filter((f) => !(MERGE_FIELDS as readonly string[]).includes(f));
}

/** Auto-selection ported from the reference script, per segment. The user may override. */
export function selectTemplateKey(segment: Segment): string {
  switch (segment) {
    case 'fmcg':
    case 'otc':
    case 'pharma':
      return TEMPLATE_KEYS.companySales;
    case 'startup_b2b':
    case 'other_company':
      return TEMPLATE_KEYS.companyStartup;
    case 'mba_commerce':
      return TEMPLATE_KEYS.collegeMba;
    default:
      return TEMPLATE_KEYS.collegeGeneral;
  }
}

/** Ensure the opt-out line is the last line of every outreach email (safety rule 4). */
export function ensureOptOutLine(body: string, optOutLine: string): string {
  const line = optOutLine.trim();
  if (!line) return body;
  const trimmed = body.trimEnd();
  if (trimmed.endsWith(line)) return trimmed;
  return `${trimmed}\n\n${line}`;
}

/** Subject for a follow-up sent in the same thread. */
export function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;
}

/** Convert the reference workbook's [Placeholder] style to merge fields. */
export function convertLegacyPlaceholders(text: string): string {
  return text
    .replace(/\[Organisation Name\]/g, '{{organisationName}}')
    .replace(/\[Company Name\]/g, '{{organisationName}}')
    .replace(/\[Contact Name\]/g, '{{contactName}}');
}

export interface MergeSource {
  organisation: { name: string };
  contact?: { fullName?: string | null; designation?: string | null } | null;
  research?: {
    trainingNeed?: string | null;
    durationFormat?: string | null;
    personalisationNote?: string | null;
  } | null;
  programme?: { name: string } | null;
  settings: { signature: string; optOutLine: string };
}

export function buildMergeVars(src: MergeSource): MergeVars {
  return {
    contactName: src.contact?.fullName ?? '',
    organisationName: src.organisation.name,
    designation: src.contact?.designation ?? '',
    programmeName: src.programme?.name ?? '',
    durationFormat: src.research?.durationFormat ?? '',
    trainingNeed: src.research?.trainingNeed ?? '',
    personalisationNote: src.research?.personalisationNote ?? '',
    signature: src.settings.signature,
    optOutLine: src.settings.optOutLine,
  };
}

/** Render subject + body and guarantee the opt-out line. */
export function renderEmail(
  template: { subject: string; body: string },
  vars: MergeVars,
): { subject: string; body: string } {
  const subject = renderTemplate(template.subject, vars).replace(/\s+/g, ' ').trim();
  const body = ensureOptOutLine(renderTemplate(template.body, vars), vars.optOutLine ?? '');
  return { subject, body };
}

import type { FetchedPage } from './ai/research';
import type { OrgType } from './constants';
import { emailDomain, isSendableAddress, normaliseEmail } from './email';

// Deterministic contact extraction for Discovery: only addresses and phone numbers that literally appear in the
// fetched text of the organisation's own website, each with the exact page URL. No AI, nothing inferred.

export interface FoundEmail {
  email: string;
  sourceUrl: string;
  /** Role guessed from the mailbox name (principal@ → Principal); null when it says nothing. */
  designation: string | null;
}

export interface FoundPhone {
  phone: string;
  sourceUrl: string;
}

const EMAIL_IN_TEXT = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
/** Asset names that look like addresses: logo@2x.png, sprite@3x.webp. */
const FILE_TLD = /\.(png|jpe?g|gif|svg|webp|ico|css|js|json|pdf)$/i;
const SYSTEM_LOCAL =
  /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?|abuse|webmaster)$/i;
/** Third-party widgets that embed their own addresses in page source. */
const VENDOR_DOMAINS =
  /(^|\.)(sentry\.io|wixpress\.com|sentry-next\.wixpress\.com|godaddy\.com|domain\.com)$/i;

/** "principal [at] abc [dot] edu [dot] in" → "principal@abc.edu.in". */
function deobfuscate(text: string): string {
  return text.replace(/\s*[[(]\s*at\s*[\])]\s*/gi, '@').replace(/\s*[[(]\s*dot\s*[\])]\s*/gi, '.');
}

const ROLES: [RegExp, string][] = [
  [/principal/, 'Principal'],
  [/director/, 'Director'],
  [/dean/, 'Dean'],
  [/placement|tpo|tnp|t&p|training/, 'Placement / Training Officer'],
  [/^hr|hr$|careers?|recruit|talent|people/, 'HR'],
  [/^l&?d|learning/, 'Learning & Development'],
  [/registrar/, 'Registrar'],
  [/admission/, 'Admissions'],
  [/^(info|contact|office|admin|enquir|inquir|mail|support|hello|ceo|md)/, 'Office'],
];

export function designationFromMailbox(email: string): string | null {
  const local = normaliseEmail(email).split('@')[0] ?? '';
  for (const [re, role] of ROLES) if (re.test(local)) return role;
  return null;
}

/** Indian mobile (10 digits, starts 6–9) or landline with STD code; returned as "+91 <national number>". */
function normalisePhone(raw: string): string | null {
  let digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.startsWith('91') && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  if (!/^\d{10}$/.test(digits)) return null;
  // Mobiles start 6–9; landlines start with a 2–4 digit STD code (never 0 or 1).
  if (!/^[2-9]/.test(digits)) return null;
  return `+91 ${digits}`;
}

const PHONE_IN_TEXT = /(?:\+91[\s-]?|\b0)?(?:\d[\s-]?){9,11}\d\b/g;

export function extractContactDetails(pages: FetchedPage[]): { emails: FoundEmail[]; phones: FoundPhone[] } {
  const emails = new Map<string, FoundEmail>();
  const phones = new Map<string, FoundPhone>();
  for (const page of pages) {
    const raw = page.fullText ?? page.text;
    const text = deobfuscate(raw);
    for (const m of text.matchAll(EMAIL_IN_TEXT)) {
      const email = normaliseEmail(m[0].replace(/^[._%+-]+|[._-]+$/g, ''));
      const [local = '', domain = ''] = email.split('@');
      if (emails.has(email) || FILE_TLD.test(email) || SYSTEM_LOCAL.test(local)) continue;
      if (VENDOR_DOMAINS.test(domain) || !isSendableAddress(email)) continue;
      emails.set(email, { email, sourceUrl: page.url, designation: designationFromMailbox(email) });
    }
    for (const m of raw.matchAll(PHONE_IN_TEXT)) {
      // A bare run of digits (no +91, leading 0 or separator) is too often an ID, pincode+number or year range.
      if (!/^\+91|^0|[\s-]/.test(m[0]) && !/^[6-9]\d{9}$/.test(m[0])) continue;
      const phone = normalisePhone(m[0]);
      if (phone && !phones.has(phone)) phones.set(phone, { phone, sourceUrl: page.url });
    }
  }
  return { emails: [...emails.values()], phones: [...phones.values()].slice(0, 5) };
}

const RANK: Record<OrgType, Record<string, number>> = {
  college_university: {
    Principal: 10,
    'Placement / Training Officer': 9,
    Director: 8,
    Dean: 7,
    Office: 4,
    Registrar: 3,
    Admissions: 1,
  },
  company: {
    HR: 10,
    'Learning & Development': 9,
    Director: 6,
    Office: 4,
  },
};

/**
 * The one address Discovery emails: the best role for the segment playbook, preferring the organisation's own
 * domain over free-mail; ties keep page order. Null when nothing was found.
 */
export function pickPrimaryEmail(
  found: FoundEmail[],
  orgType: OrgType,
  orgDomain: string | null,
): FoundEmail | null {
  let best: { f: FoundEmail; score: number } | null = null;
  for (const f of found) {
    const score =
      (f.designation ? (RANK[orgType][f.designation] ?? 2) : 2) + (isOfficial(f.email, orgDomain) ? 2 : 0);
    if (!best || score > best.score) best = { f, score };
  }
  return best?.f ?? null;
}

function isOfficial(email: string, orgDomain: string | null): boolean {
  const domain = emailDomain(email);
  return !!orgDomain && (domain === orgDomain || domain.endsWith(`.${orgDomain}`));
}

/**
 * Which found addresses become contacts. Sites often show alumni or partner addresses (testimonials, recruiters),
 * so when the organisation publishes any address on its own domain only those are kept; otherwise (e.g. government
 * colleges on Gmail) the first few are kept.
 */
export function selectContactsToSave(found: FoundEmail[], orgDomain: string | null, max = 5): FoundEmail[] {
  const official = found.filter((f) => isOfficial(f.email, orgDomain));
  return (official.length ? official : found).slice(0, max);
}

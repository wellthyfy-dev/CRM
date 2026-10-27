import { SEGMENT_LABELS, type OrgType, type Segment } from './constants';
import { normaliseDomain } from './email';

// Discovery: turn search results into candidate organisations. Pure and unit-tested.

/** Social media, directories, news, job boards, marketplaces and other non-official sites. */
export const EXCLUDED_DOMAINS = [
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'wikipedia.org',
  'justdial.com',
  'indiamart.com',
  'tradeindia.com',
  'sulekha.com',
  'shiksha.com',
  'collegedunia.com',
  'careers360.com',
  'getmyuni.com',
  'collegedekho.com',
  'collegesearch.in',
  'universitykart.com',
  'zaubacorp.com',
  'tofler.in',
  'crunchbase.com',
  'glassdoor.com',
  'glassdoor.co.in',
  'naukri.com',
  'indeed.com',
  'monster.com',
  'foundit.in',
  'shine.com',
  'apna.co',
  'ambitionbox.com',
  'quora.com',
  'reddit.com',
  'medium.com',
  'thehindu.com',
  'timesofindia.indiatimes.com',
  'indiatimes.com',
  'ndtv.com',
  'hindustantimes.com',
  'economictimes.com',
  'deccanchronicle.com',
  'news18.com',
  'yourstory.com',
  'inc42.com',
  'google.com',
  'maps.google.com',
  'amazon.in',
  'flipkart.com',
  'mapsofindia.com',
  'yellowpages.in',
  'asklaila.com',
] as const;

const EXCLUDED_PATTERNS = [
  /news/,
  /jobs?\./,
  /careers?\d*\./,
  /directory/,
  /listing/,
  /review/,
  /blogspot\./,
  /wordpress\.com$/,
];

export function isExcludedDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  if (EXCLUDED_DOMAINS.some((x) => d === x || d.endsWith(`.${x}`))) return true;
  return EXCLUDED_PATTERNS.some((re) => re.test(d));
}

export interface SearchResult {
  title: string;
  link: string;
  snippet?: string;
}

export interface Candidate {
  name: string;
  website: string;
  domain: string;
  snippet: string;
  query: string;
}

/** Clean a search-result title into an organisation name ("PSG College – Home | Coimbatore" → "PSG College"). */
export function nameFromTitle(title: string): string {
  const first = title.split(/\s[|–—-]\s|\s::\s/)[0] ?? title;
  return (
    first
      .replace(/\b(home|official (web)?site|welcome to)\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim() || title.trim()
  );
}

/** Normalise domains, drop excluded sites, existing organisations and duplicates. */
export function filterSearchResults(
  results: SearchResult[],
  query: string,
  existingDomains: Set<string>,
  seen: Set<string> = new Set(),
): Candidate[] {
  const out: Candidate[] = [];
  for (const r of results) {
    const domain = normaliseDomain(r.link);
    if (!domain || isExcludedDomain(domain) || existingDomains.has(domain) || seen.has(domain)) continue;
    seen.add(domain);
    let website = r.link;
    try {
      website = `${new URL(r.link).protocol}//${new URL(r.link).host}/`;
    } catch {
      /* keep link */
    }
    out.push({ name: nameFromTitle(r.title), website, domain, snippet: r.snippet ?? '', query });
  }
  return out;
}

const SEGMENT_TERMS: Record<Segment, string> = {
  arts_science: 'arts and science college',
  engineering: 'engineering college',
  mba_commerce: 'MBA business school',
  other_college: 'college',
  fmcg: 'FMCG company',
  otc: 'OTC consumer healthcare company',
  pharma: 'pharmaceutical company',
  startup_b2b: 'B2B startup',
  other_company: 'company',
};

/** Search queries for a discovery run (a few variants to widen recall). */
export function buildDiscoveryQueries(p: {
  orgType: OrgType;
  segment?: Segment | null;
  state: string;
  city?: string | null;
  keywords?: string | null;
}): string[] {
  const what = p.segment
    ? SEGMENT_TERMS[p.segment]
    : p.orgType === 'college_university'
      ? 'college'
      : 'company';
  const where = [p.city, p.state].filter(Boolean).join(' ');
  const kw = p.keywords?.trim() ? ` ${p.keywords.trim()}` : '';
  const base = `${what}${kw} in ${where}`;
  const extra =
    p.orgType === 'college_university'
      ? [`${base} official website`, `${base} placement cell`]
      : [`${base} official website`, `${base} sales team head office`];
  return [base, ...extra];
}

export function describeDiscovery(p: {
  orgType: OrgType;
  segment?: Segment | null;
  state: string;
  city?: string | null;
}): string {
  return `${p.segment ? SEGMENT_LABELS[p.segment] : p.orgType} · ${[p.city, p.state].filter(Boolean).join(', ')}`;
}

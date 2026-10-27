import type { FetchedPage } from '../ai/research';
import { normaliseDomain } from '../email';

// Fetches an organisation's home page plus up to 6 relevant same-domain pages, as plain text.

const RELEVANT = [
  'about',
  'placement',
  'training',
  'department',
  'contact',
  'leadership',
  'management',
  'principal',
  'director',
  'careers',
  'team',
  'people',
  'faculty',
  'administration',
  'hr',
  'learning',
];
const SKIP_EXT = /\.(pdf|jpe?g|png|gif|svg|webp|zip|docx?|xlsx?|pptx?|mp4|mp3)(\?|$)/i;
const MAX_PAGE_BYTES = 1_500_000;
/** ~20k tokens at ~4 chars/token. */
export const MAX_TOTAL_CHARS = 80_000;
const PER_PAGE_CHARS = 16_000;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
};

export function htmlToText(html: string): { title: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? '';
  const text = html
    .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Keep mailto addresses visible: they are often only in href.
    .replace(/<a[^>]+href=["']mailto:([^"'?]+)[^>]*>/gi, ' $1 ')
    .replace(/<(br|p|div|li|tr|h[1-6]|section|article|td)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(
      /&(#?\w+);/g,
      (m, e: string) =>
        ENTITIES[e] ?? (e.startsWith('#') ? String.fromCharCode(Number(e.slice(1)) || 32) : m),
    )
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
  return { title: title.replace(/\s+/g, ' '), text };
}

export function extractLinks(html: string, baseUrl: string): string[] {
  const links = new Set<string>();
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1]!, baseUrl);
      if (!/^https?:$/.test(u.protocol) || SKIP_EXT.test(u.pathname)) continue;
      u.hash = '';
      links.add(u.toString());
    } catch {
      /* ignore bad hrefs */
    }
  }
  return [...links];
}

/** Rank same-domain links by relevance keywords in the URL path. */
export function pickRelevantLinks(links: string[], domain: string, max = 6): string[] {
  const scored = links
    .filter((l) => normaliseDomain(l) === domain)
    .map((l) => {
      const path = new URL(l).pathname.toLowerCase();
      const score = RELEVANT.reduce((s, k) => s + (path.includes(k) ? 1 : 0), 0);
      return { l, score, depth: path.split('/').filter(Boolean).length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.depth - b.depth);
  return [...new Set(scored.map((x) => x.l))].slice(0, max);
}

async function fetchHtml(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ url: string; html: string } | null> {
  try {
    const res = await fetchImpl(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'WellthyfyOutreachCRM/1.0 (+https://wellthyfy.in)', Accept: 'text/html' },
    });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_PAGE_BYTES) return null;
    return { url: res.url || url, html: new TextDecoder().decode(buf) };
  } catch {
    return null;
  }
}

export async function fetchSitePages(
  website: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchedPage[]> {
  const home = await fetchHtml(website, fetchImpl);
  if (!home) return [];
  const domain = normaliseDomain(home.url) ?? normaliseDomain(website);
  const pages: FetchedPage[] = [];
  let total = 0;
  const add = (url: string, html: string) => {
    const { title, text } = htmlToText(html);
    const clipped = text.slice(0, Math.min(PER_PAGE_CHARS, MAX_TOTAL_CHARS - total));
    if (!clipped) return;
    total += clipped.length;
    pages.push({ url, title, text: clipped });
  };
  add(home.url, home.html);
  if (!domain) return pages;
  for (const link of pickRelevantLinks(extractLinks(home.html, home.url), domain)) {
    if (total >= MAX_TOTAL_CHARS) break;
    if (pages.some((p) => p.url === link)) continue;
    const page = await fetchHtml(link, fetchImpl);
    if (page) add(page.url, page.html);
  }
  return pages;
}

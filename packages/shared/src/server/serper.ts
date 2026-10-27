import type { SearchResult } from '../discovery';

export interface WebSearcher {
  readonly configured: boolean;
  /** One Serper search = one unit of the monthly search limit. */
  search(query: string, options: { num: number; page?: number }): Promise<SearchResult[]>;
}

export function serperSearcher(apiKey: string | undefined, fetchImpl: typeof fetch = fetch): WebSearcher {
  return {
    configured: !!apiKey,
    async search(query, { num, page = 1 }) {
      if (!apiKey) throw new Error('SERPER_API_KEY is not set');
      const res = await fetchImpl('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, gl: 'in', hl: 'en', num: Math.min(num, 100), page }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Serper HTTP ${res.status}`);
      const body = (await res.json()) as { organic?: { title?: string; link?: string; snippet?: string }[] };
      return (body.organic ?? [])
        .filter((r) => r.link)
        .map((r) => ({ title: r.title ?? '', link: r.link!, snippet: r.snippet ?? '' }));
    },
  };
}

import { and, eq, gte, isNotNull, sum } from 'drizzle-orm';
import {
  buildDiscoveryQueries,
  filterSearchResults,
  startOfIstMonth,
  type OrgType,
  type Segment,
} from '@wellthyfy/shared';
import {
  discoveryRuns,
  getSettings,
  organisations,
  QUEUES,
  type Db,
  type DiscoveryCandidate,
} from '@wellthyfy/shared/server';
import type { JobDefinition, WorkerDeps } from '../runtime';

const PAGES_PER_QUERY = 3;
const RESULTS_PER_SEARCH = 20;

export async function searchesThisMonth(db: Db, now: Date): Promise<number> {
  const [row] = await db
    .select({ n: sum(discoveryRuns.searchesUsed) })
    .from(discoveryRuns)
    .where(gte(discoveryRuns.createdAt, startOfIstMonth(now)));
  return Number(row?.n ?? 0);
}

export async function runDiscovery(deps: WorkerDeps, runId: string): Promise<void> {
  const { db, now } = deps;
  const [run] = await db.select().from(discoveryRuns).where(eq(discoveryRuns.id, runId));
  if (!run || run.status !== 'pending') return;
  await db.update(discoveryRuns).set({ status: 'running' }).where(eq(discoveryRuns.id, runId));
  try {
    if (!deps.searcher.configured) throw new Error('SERPER_API_KEY is not configured');
    const p = run.params as {
      orgType: OrgType;
      segment?: Segment;
      state: string;
      city?: string;
      keywords?: string;
      maxResults: number;
    };
    const s = await getSettings(db);
    const alreadyUsed = await searchesThisMonth(db, now());
    const existing = new Set(
      (
        await db
          .select({ d: organisations.domain })
          .from(organisations)
          .where(and(isNotNull(organisations.domain)))
      )
        .map((r) => r.d!)
        .filter(Boolean),
    );
    const seen = new Set<string>();
    const found: DiscoveryCandidate[] = [];
    let searches = 0;
    let note: string | null = null;
    outer: for (const q of buildDiscoveryQueries(p)) {
      for (let page = 1; page <= PAGES_PER_QUERY; page++) {
        if (alreadyUsed + searches >= s.searchMonthlyLimit) {
          note = 'Monthly search limit reached';
          break outer;
        }
        const results = await deps.searcher.search(q, { num: RESULTS_PER_SEARCH, page });
        searches++;
        found.push(...filterSearchResults(results, q, existing, seen));
        if (found.length >= p.maxResults || results.length < RESULTS_PER_SEARCH) break;
      }
      if (found.length >= p.maxResults) break;
    }
    const results = found.slice(0, p.maxResults);
    await db
      .update(discoveryRuns)
      .set({ status: 'done', results, resultsCount: results.length, searchesUsed: searches, error: note })
      .where(eq(discoveryRuns.id, runId));
  } catch (err) {
    await db
      .update(discoveryRuns)
      .set({ status: 'failed', error: (err as Error).message.slice(0, 500) })
      .where(eq(discoveryRuns.id, runId));
  }
}

export const discoveryJob: JobDefinition = {
  queue: QUEUES.discovery,
  async handler(deps, data) {
    await runDiscovery(deps, String(data.runId ?? ''));
  },
};

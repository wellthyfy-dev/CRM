import { Router } from 'express';
import { desc, eq, gte, sum } from 'drizzle-orm';
import {
  describeDiscovery,
  discoveryAddSchema,
  discoveryCreateSchema,
  guessSegment,
  orgTypeForSegment,
  startOfIstMonth,
} from '@wellthyfy/shared';
import {
  discoveryRuns,
  getSettings,
  logActivity,
  organisations,
  profiles,
  QUEUES,
} from '@wellthyfy/shared/server';
import type { RouteDeps } from '../app';
import { canEdit, currentUser } from '../lib/auth';
import { badRequest, notFound } from '../lib/errors';
import { idParam, parseBody } from '../lib/http';

export function discoveryRoutes({ db, publisher, env, now }: RouteDeps): Router {
  const r = Router();

  async function searchesUsed() {
    const [row] = await db
      .select({ n: sum(discoveryRuns.searchesUsed) })
      .from(discoveryRuns)
      .where(gte(discoveryRuns.createdAt, startOfIstMonth(now())));
    return Number(row?.n ?? 0);
  }

  r.get('/discovery', canEdit, async (_req, res) => {
    const s = await getSettings(db);
    const runs = await db
      .select({
        id: discoveryRuns.id,
        query: discoveryRuns.query,
        params: discoveryRuns.params,
        status: discoveryRuns.status,
        resultsCount: discoveryRuns.resultsCount,
        searchesUsed: discoveryRuns.searchesUsed,
        error: discoveryRuns.error,
        createdAt: discoveryRuns.createdAt,
        createdByName: profiles.fullName,
      })
      .from(discoveryRuns)
      .leftJoin(profiles, eq(profiles.id, discoveryRuns.createdBy))
      .orderBy(desc(discoveryRuns.createdAt))
      .limit(50);
    res.json({
      runs,
      searchesUsed: await searchesUsed(),
      searchLimit: s.searchMonthlyLimit,
      configured: !!env.SERPER_API_KEY,
    });
  });

  r.post('/discovery', canEdit, async (req, res) => {
    const user = currentUser(req);
    const body = parseBody(discoveryCreateSchema, req);
    if (body.segment && orgTypeForSegment(body.segment) !== body.orgType)
      throw badRequest('Segment does not match the type');
    if (!env.SERPER_API_KEY) throw badRequest('Search is not configured (SERPER_API_KEY)');
    const s = await getSettings(db);
    if ((await searchesUsed()) >= s.searchMonthlyLimit)
      throw badRequest('Monthly search limit reached — raise it in Settings');
    const [run] = await db
      .insert(discoveryRuns)
      .values({ query: describeDiscovery(body), params: body, status: 'pending', createdBy: user.id })
      .returning();
    await publisher.send(QUEUES.discovery, { runId: run!.id });
    await logActivity(db, {
      userId: user.id,
      type: 'discovery_started',
      payload: { runId: run!.id, params: body },
    });
    res.status(201).json(run);
  });

  r.get('/discovery/:id', canEdit, async (req, res) => {
    const [run] = await db
      .select()
      .from(discoveryRuns)
      .where(eq(discoveryRuns.id, idParam(req)));
    if (!run) throw notFound('Discovery run not found');
    res.json(run);
  });

  /** "Add selected": create organisations (stage research_needed, source discovery), optionally queue AI research. */
  r.post('/discovery/:id/add', canEdit, async (req, res) => {
    const user = currentUser(req);
    const [run] = await db
      .select()
      .from(discoveryRuns)
      .where(eq(discoveryRuns.id, idParam(req)));
    if (!run) throw notFound('Discovery run not found');
    const body = parseBody(discoveryAddSchema, req);
    const params = run.params as {
      orgType: 'college_university' | 'company';
      segment?: string;
      state?: string;
      city?: string;
    };
    const created: { id: string; recordId: string; name: string }[] = [];
    const skipped: { domain: string; reason: string }[] = [];
    const results = [...run.results];
    for (const domain of body.domains) {
      const c = results.find((x) => x.domain === domain);
      if (!c) {
        skipped.push({ domain, reason: 'not in this run' });
        continue;
      }
      const [dupe] = await db
        .select({ id: organisations.id })
        .from(organisations)
        .where(eq(organisations.domain, domain));
      if (dupe) {
        skipped.push({ domain, reason: 'already exists' });
        c.existingOrganisationId = dupe.id;
        continue;
      }
      const segment = (params.segment as never) ?? guessSegment(params.orgType, c.name, c.snippet);
      const [org] = await db
        .insert(organisations)
        .values({
          name: c.name.slice(0, 300),
          orgType: params.orgType,
          segment,
          website: c.website,
          domain,
          city: params.city ?? null,
          state: params.state ?? null,
          stage: 'research_needed',
          source: 'discovery',
          ownerId: user.id,
          createdBy: user.id,
          notes: c.snippet ? `Search snippet: ${c.snippet}` : null,
        })
        .returning({ id: organisations.id, recordId: organisations.recordId, name: organisations.name });
      created.push(org!);
      c.added = true;
      c.existingOrganisationId = org!.id;
      await logActivity(db, {
        organisationId: org!.id,
        userId: user.id,
        type: 'organisation_created',
        payload: { source: 'discovery', runId: run.id, query: c.query },
      });
      if (body.queueResearch && env.ANTHROPIC_API_KEY) {
        await publisher.send(QUEUES.aiResearch, { organisationId: org!.id, userId: user.id });
      }
    }
    await db.update(discoveryRuns).set({ results }).where(eq(discoveryRuns.id, run.id));
    res.json({ created, skipped });
  });

  return r;
}

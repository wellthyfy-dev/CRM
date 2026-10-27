import { eq, ilike } from 'drizzle-orm';
import { buildResearchPrompt, filterVerbatimContacts, RESEARCH_SYSTEM } from '@wellthyfy/shared';
import {
  aiBudgetAvailable,
  AiRefusalError,
  effectiveAiModel,
  getSettings,
  logActivity,
  organisations,
  programmes,
  QUEUES,
  recordAiUsage,
  research,
} from '@wellthyfy/shared/server';
import type { JobDefinition, WorkerDeps } from '../runtime';

export async function runAiResearch(
  deps: WorkerDeps,
  organisationId: string,
  userId: string | null,
): Promise<{ researchId: string | null; error?: string }> {
  const { db, env, now } = deps;
  const fail = async (error: string) => {
    await logActivity(db, { organisationId, userId, type: 'ai_research_failed', payload: { error } });
    return { researchId: null, error };
  };
  const [org] = await db.select().from(organisations).where(eq(organisations.id, organisationId));
  if (!org) return { researchId: null, error: 'Organisation not found' };
  if (!org.website) return fail('Organisation has no website');
  if (!deps.ai.configured) return fail('ANTHROPIC_API_KEY is not configured');
  const s = await getSettings(db);
  if (!(await aiBudgetAvailable(db, s, now()))) return fail('Monthly AI limit reached');

  const pages = await deps.fetchPages(org.website);
  if (pages.length === 0) return fail('Could not fetch the website');
  const progs = await db.select().from(programmes).where(eq(programmes.active, true));
  const model = effectiveAiModel(s, env.AI_MODEL_DEFAULT);
  let res;
  try {
    res = await deps.ai.research(
      model,
      RESEARCH_SYSTEM,
      buildResearchPrompt({ organisation: org, programmes: progs, pages }),
    );
  } catch (err) {
    return fail(
      err instanceof AiRefusalError ? 'The AI declined this request' : `AI error: ${(err as Error).message}`,
    );
  }
  const out = res.output;
  // Safety rule 3: drop any contact whose name/email is not verbatim on the page it cites.
  const { kept, dropped } = filterVerbatimContacts(out.candidateContacts, pages);
  const validUrls = new Set(pages.map((p) => p.url));
  const evidence = out.websiteEvidence.filter((e) => validUrls.has(e.url));
  const [programme] = out.recommendedProgrammeName
    ? await db
        .select({ id: programmes.id })
        .from(programmes)
        .where(ilike(programmes.name, out.recommendedProgrammeName))
    : [];
  const costInr = await recordAiUsage(
    db,
    { purpose: 'research', model, tokensIn: res.tokensIn, tokensOut: res.tokensOut, organisationId },
    env.USD_TO_INR,
  );
  const [row] = await db
    .insert(research)
    .values({
      organisationId,
      trainingNeed: out.trainingNeed || null,
      websiteEvidence: evidence.map((e) => `"${e.quote}" — ${e.url}`).join('\n') || null,
      recommendedProgrammeId: programme?.id ?? null,
      durationFormat: out.durationFormat || null,
      personalisationNote: out.personalisationNote || null,
      sourcePages: pages.map((p) => ({ url: p.url, title: p.title })),
      aiOutput: {
        websiteEvidence: evidence,
        candidateContacts: kept,
        droppedContacts: dropped.length,
        recommendedProgrammeName: out.recommendedProgrammeName,
        draftSubject: out.draftSubject,
        draftBody: out.draftBody,
        confidence: out.confidence,
      },
      aiModel: model,
      aiGenerated: true,
      tokensIn: res.tokensIn,
      tokensOut: res.tokensOut,
      costInr,
      createdBy: userId,
    })
    .returning({ id: research.id });
  await logActivity(db, {
    organisationId,
    userId,
    type: 'ai_research_completed',
    payload: {
      researchId: row!.id,
      model,
      costInr,
      candidates: kept.length,
      droppedCandidates: dropped.length,
    },
  });
  return { researchId: row!.id };
}

export const aiResearchJob: JobDefinition = {
  queue: QUEUES.aiResearch,
  batchSize: 1,
  async handler(deps, data) {
    const r = await runAiResearch(deps, String(data.organisationId ?? ''), (data.userId as string) ?? null);
    deps.logger.info(r, 'ai research');
  },
};

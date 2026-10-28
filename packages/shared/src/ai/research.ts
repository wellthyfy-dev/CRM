import { z } from 'zod';

// AI research output contract (Step 2.5). Validated with Zod; contacts are re-checked server-side.

export const aiCandidateContactSchema = z.object({
  name: z.string(),
  designation: z.string(),
  email: z.string(),
  sourceUrl: z.string(),
  quote: z.string(),
});
export type AiCandidateContact = z.infer<typeof aiCandidateContactSchema>;

export const aiResearchOutputSchema = z.object({
  trainingNeed: z.string(),
  websiteEvidence: z.array(z.object({ quote: z.string(), url: z.string() })),
  recommendedProgrammeName: z.string(),
  durationFormat: z.string(),
  personalisationNote: z.string(),
  candidateContacts: z.array(aiCandidateContactSchema),
  draftSubject: z.string(),
  draftBody: z.string(),
  confidence: z.enum(['low', 'medium', 'high']),
});
export type AiResearchOutput = z.infer<typeof aiResearchOutputSchema>;

export const aiReplyClassificationSchema = z.object({
  classification: z.enum(['interested', 'not_interested', 'other']),
  summary: z.string(),
});
export type AiReplyClassification = z.infer<typeof aiReplyClassificationSchema>;

export interface FetchedPage {
  url: string;
  title?: string;
  text: string;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Safety rule 3: keep only candidates whose name AND email (when given) appear verbatim in the fetched text of the
 * exact page they cite. Anything else is dropped — the AI must never invent people or addresses.
 */
export function filterVerbatimContacts(
  candidates: AiCandidateContact[],
  pages: FetchedPage[],
): { kept: AiCandidateContact[]; dropped: { candidate: AiCandidateContact; reason: string }[] } {
  const byUrl = new Map(pages.map((p) => [p.url, squash(p.text)]));
  const kept: AiCandidateContact[] = [];
  const dropped: { candidate: AiCandidateContact; reason: string }[] = [];
  for (const c of candidates) {
    const text = byUrl.get(c.sourceUrl.trim());
    const name = squash(c.name);
    const email = squash(c.email);
    if (!text) dropped.push({ candidate: c, reason: 'sourceUrl is not one of the fetched pages' });
    else if (!name && !email) dropped.push({ candidate: c, reason: 'no name or email' });
    else if (name && !text.includes(name))
      dropped.push({ candidate: c, reason: 'name not found verbatim on page' });
    else if (email && !text.includes(email))
      dropped.push({ candidate: c, reason: 'email not found verbatim on page' });
    else if (c.designation && !text.includes(squash(c.designation))) {
      // Designation is kept only if it also appears; otherwise blank it rather than trust it.
      kept.push({ ...c, designation: '' });
    } else kept.push(c);
  }
  return { kept, dropped };
}

/** Pricing per million tokens (USD; Gemini output includes thinking tokens). Unknown models use the highest rate. */
export const AI_PRICING_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
  'gemini-3.8-flash': { input: 1.5, output: 7.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
};

const FALLBACK_PRICING = Object.values(AI_PRICING_USD_PER_MTOK).reduce((a, b) =>
  b.output > a.output ? b : a,
);

export function aiCostInr(model: string, tokensIn: number, tokensOut: number, usdToInr = 88): number {
  const p = AI_PRICING_USD_PER_MTOK[model] ?? FALLBACK_PRICING;
  const usd = (tokensIn * p.input + tokensOut * p.output) / 1_000_000;
  return Math.round(usd * usdToInr * 10000) / 10000;
}

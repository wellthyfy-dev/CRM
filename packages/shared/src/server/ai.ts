import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { and, gte, sum } from 'drizzle-orm';
import {
  aiCostInr,
  aiReplyClassificationSchema,
  aiResearchOutputSchema,
  type AiReplyClassification,
  type AiResearchOutput,
} from '../ai/research';
import type { Db } from '../db/client';
import { aiUsage, type Settings } from '../db/schema';
import { startOfIstMonth } from '../time';

export interface AiResult<T> {
  output: T;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

/** AI calls behind an interface so jobs are testable without the network. */
export interface AiProvider {
  readonly configured: boolean;
  research(model: string, system: string, prompt: string): Promise<AiResult<AiResearchOutput>>;
  classifyReply(model: string, replyText: string): Promise<AiResult<AiReplyClassification>>;
}

export class AiRefusalError extends Error {}

const CLASSIFY_SYSTEM = `You classify replies to B2B training-outreach emails sent by Wellthyfy Lifestyle Ventures.
Return "interested" if the sender wants to talk, meet, receive a proposal, or asks for details/pricing/dates.
Return "not_interested" if they decline (now or in general). Otherwise return "other".
The summary is one short neutral sentence describing what the sender said. Never invent details.`;

export function anthropicProvider(apiKey: string | undefined): AiProvider {
  const client = apiKey ? new Anthropic({ apiKey, maxRetries: 2, timeout: 5 * 60_000 }) : null;
  return {
    configured: !!client,
    async research(model, system, prompt) {
      if (!client) throw new Error('ANTHROPIC_API_KEY is not set');
      const res = await client.messages.parse({
        model,
        max_tokens: 16000,
        system,
        messages: [{ role: 'user', content: prompt }],
        output_config: { format: zodOutputFormat(aiResearchOutputSchema), effort: 'medium' },
      });
      if (res.stop_reason === 'refusal') throw new AiRefusalError('The model declined this request');
      if (!res.parsed_output)
        throw new Error(`AI output did not match the schema (stop: ${res.stop_reason})`);
      return {
        output: res.parsed_output,
        model,
        tokensIn: res.usage.input_tokens,
        tokensOut: res.usage.output_tokens,
      };
    },
    async classifyReply(model, replyText) {
      if (!client) throw new Error('ANTHROPIC_API_KEY is not set');
      const res = await client.messages.parse({
        model,
        max_tokens: 2000,
        system: CLASSIFY_SYSTEM,
        messages: [{ role: 'user', content: `<reply>\n${replyText.slice(0, 8000)}\n</reply>` }],
        output_config: { format: zodOutputFormat(aiReplyClassificationSchema), effort: 'low' },
      });
      if (res.stop_reason === 'refusal') throw new AiRefusalError('The model declined this request');
      if (!res.parsed_output) throw new Error('AI classification did not match the schema');
      return {
        output: res.parsed_output,
        model,
        tokensIn: res.usage.input_tokens,
        tokensOut: res.usage.output_tokens,
      };
    },
  };
}

/** AI spend (INR) this IST calendar month. */
export async function aiSpendThisMonth(db: Db, now: Date): Promise<number> {
  const [row] = await db
    .select({ total: sum(aiUsage.costInr) })
    .from(aiUsage)
    .where(and(gte(aiUsage.createdAt, startOfIstMonth(now))));
  return Number(row?.total ?? 0);
}

export async function aiBudgetAvailable(
  db: Db,
  s: Pick<Settings, 'aiMonthlyLimitInr'>,
  now: Date,
): Promise<boolean> {
  return (await aiSpendThisMonth(db, now)) < Number(s.aiMonthlyLimitInr);
}

export async function recordAiUsage(
  db: Db,
  input: {
    purpose: string;
    model: string;
    tokensIn: number;
    tokensOut: number;
    organisationId?: string | null;
  },
  usdToInr: number,
): Promise<number> {
  const costInr = aiCostInr(input.model, input.tokensIn, input.tokensOut, usdToInr);
  await db.insert(aiUsage).values({ ...input, organisationId: input.organisationId ?? null, costInr });
  return costInr;
}

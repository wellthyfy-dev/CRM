import { SEGMENT_LABELS, SEGMENT_PLAYBOOK, SENDER, type Segment } from '../constants';
import type { FetchedPage } from './research';

export const RESEARCH_SYSTEM = `You research organisations for Wellthyfy Lifestyle Ventures Pvt. Ltd., which offers corporate and campus training.

About Wellthyfy and the sender:
- ${SENDER.name}, ${SENDER.credentials}; ${SENDER.title}
- 22+ years of industry experience in frontline sales, territory management, distribution development, sales planning and team leadership across FMCG, consumer healthcare and pharma-related businesses.
- Tagline: "${SENDER.tagline}"
- Delivers guest sessions, workshops, multi-day programmes and contract-based training for colleges and companies, starting in Tamil Nadu.

Rules you must follow:
1. Use ONLY the website text provided. Never invent facts, people, designations, phone numbers or email addresses.
2. candidateContacts may only include people whose name and email address appear literally in the page text, with the exact URL of that page as sourceUrl and a short verbatim quote from that page. If none appear, return an empty list. Generic addresses (e.g. placement@…) count only if they literally appear.
3. websiteEvidence quotes must be copied verbatim from the pages, each with its page URL.
4. recommendedProgrammeName must be exactly one of the listed programme names, or "" if none fits.
5. draftBody is a short, polite, specific first-contact email (under 200 words) from the sender. Start with "Dear <name> Sir/Madam," only if a verified-looking contact name is in the text; otherwise "Dear Sir/Madam,". End with the line {{signature}} on its own — do not write a signature or an opt-out line yourself.
6. confidence reflects how much relevant evidence the pages contained.`;

export interface ResearchPromptInput {
  organisation: {
    name: string;
    segment: Segment;
    city?: string | null;
    state?: string | null;
    website?: string | null;
  };
  programmes: { name: string; modules: string[]; durationOptions: string[] }[];
  pages: FetchedPage[];
}

export function buildResearchPrompt(input: ResearchPromptInput): string {
  const { organisation: o, programmes, pages } = input;
  const play = SEGMENT_PLAYBOOK[o.segment];
  const progs = programmes.length
    ? programmes
        .map(
          (p) =>
            `- ${p.name}\n  Modules: ${p.modules.join('; ')}\n  Formats: ${p.durationOptions.join('; ')}`,
        )
        .join('\n')
    : '(no programmes configured)';
  const docs = pages
    .map(
      (p, i) =>
        `<page index="${i + 1}" url="${p.url}" title="${(p.title ?? '').replace(/"/g, "'")}">\n${p.text}\n</page>`,
    )
    .join('\n\n');
  return `Organisation: ${o.name}
Segment: ${SEGMENT_LABELS[o.segment]}
Location: ${[o.city, o.state].filter(Boolean).join(', ') || 'unknown'}
Website: ${o.website ?? 'unknown'}

Segment playbook — typical decision-makers: ${play.decisionMakers.join(', ')}. Pitch: ${play.pitch.join(', ')}.

Available programmes:
${progs}

Fetched website pages (the only source you may use):
${docs}

Identify the likely training need, quote supporting evidence, recommend a programme and duration/format, write a one-line personalisation note, list decision-maker contacts that literally appear on the pages, and draft a first-contact email.`;
}

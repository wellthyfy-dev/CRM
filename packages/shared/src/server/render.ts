import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { programmes, research, type Contact, type Organisation, type Template } from '../db/schema';
import { buildMergeVars, renderEmail } from '../templates/render';
import { effectiveOptOutLine, getSettings } from './settings';

export async function latestResearch(db: Db, organisationId: string) {
  const [r] = await db
    .select()
    .from(research)
    .where(eq(research.organisationId, organisationId))
    .orderBy(desc(research.createdAt))
    .limit(1);
  return r ?? null;
}

/** Render a template for an organisation + contact using the latest research and settings. */
export async function renderForContact(
  db: Db,
  org: Organisation,
  contact: Contact | null,
  template: Pick<Template, 'subject' | 'body'>,
) {
  const r = await latestResearch(db, org.id);
  const programme = r?.recommendedProgrammeId
    ? ((await db.select().from(programmes).where(eq(programmes.id, r.recommendedProgrammeId)))[0] ?? null)
    : null;
  const s = await getSettings(db);
  const optOutLine = effectiveOptOutLine(s);
  const vars = buildMergeVars({
    organisation: org,
    contact,
    research: r,
    programme,
    settings: { signature: s.signature, optOutLine },
  });
  return { ...renderEmail(template, vars), optOutLine, research: r, programme };
}

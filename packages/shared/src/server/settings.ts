import { eq } from 'drizzle-orm';
import { DEFAULT_OPT_OUT_LINE, DEFAULT_SIGNATURE } from '../constants';
import type { Db } from '../db/client';
import { settings, type Settings } from '../db/schema';

/** Load the single settings row, creating it with defaults if missing. */
export async function getSettings(db: Db): Promise<Settings> {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1));
  if (row) return row;
  const [created] = await db
    .insert(settings)
    .values({ id: 1, signature: DEFAULT_SIGNATURE, optOutLine: DEFAULT_OPT_OUT_LINE })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [again] = await db.select().from(settings).where(eq(settings.id, 1));
  if (!again) throw new Error('Settings row missing');
  return again;
}

/** Opt-out line as appended to emails, including the privacy notice link when configured. */
export function effectiveOptOutLine(s: Pick<Settings, 'optOutLine' | 'privacyNoticeUrl'>): string {
  const line = (s.optOutLine || DEFAULT_OPT_OUT_LINE).trim();
  if (s.privacyNoticeUrl && !line.includes(s.privacyNoticeUrl)) {
    return `${line} Privacy notice: ${s.privacyNoticeUrl}`;
  }
  return line;
}

export function effectiveAiModel(s: Pick<Settings, 'aiModel'>, envDefault: string): string {
  return s.aiModel?.trim() || envDefault;
}

import { eq } from 'drizzle-orm';
import { DEFAULT_OPT_OUT_LINE, DEFAULT_SETTINGS, DEFAULT_SIGNATURE } from '../constants';
import { SEED_PROGRAMMES, SEED_TEMPLATES } from '../templates/seed-data';
import type { Db } from './client';
import { programmes, settings, templates, templateVersions } from './schema';

/** Idempotent seed: settings row, templates (only missing keys), sample programmes (only if none exist). */
export async function seed(db: Db): Promise<{ templates: number; programmes: number }> {
  await db
    .insert(settings)
    .values({
      id: 1,
      dailySendCap: DEFAULT_SETTINGS.dailySendCap,
      hourlySendCap: DEFAULT_SETTINGS.hourlySendCap,
      sendWindowStart: DEFAULT_SETTINGS.sendWindowStart,
      sendWindowEnd: DEFAULT_SETTINGS.sendWindowEnd,
      sendDays: [...DEFAULT_SETTINGS.sendDays],
      followUp1Days: DEFAULT_SETTINGS.followUp1Days,
      followUp2Days: DEFAULT_SETTINGS.followUp2Days,
      aiMonthlyLimitInr: DEFAULT_SETTINGS.aiMonthlyLimitInr,
      searchMonthlyLimit: DEFAULT_SETTINGS.searchMonthlyLimit,
      signature: DEFAULT_SIGNATURE,
      optOutLine: DEFAULT_OPT_OUT_LINE,
    })
    .onConflictDoNothing();

  let templateCount = 0;
  for (const t of SEED_TEMPLATES) {
    const [row] = await db
      .insert(templates)
      .values({ ...t, version: 1 })
      .onConflictDoNothing()
      .returning({ id: templates.id });
    if (row) {
      templateCount++;
      await db
        .insert(templateVersions)
        .values({ templateId: row.id, version: 1, subject: t.subject, body: t.body });
    }
  }

  let programmeCount = 0;
  const existing = await db.select({ id: programmes.id }).from(programmes).limit(1);
  if (existing.length === 0) {
    for (const p of SEED_PROGRAMMES) {
      await db.insert(programmes).values(p);
      programmeCount++;
    }
  }
  return { templates: templateCount, programmes: programmeCount };
}

export async function getTemplateByKey(db: Db, key: string) {
  const [row] = await db.select().from(templates).where(eq(templates.key, key));
  return row ?? null;
}

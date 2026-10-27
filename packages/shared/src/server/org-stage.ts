import { eq } from 'drizzle-orm';
import type { Stage } from '../constants';
import type { Db } from '../db/client';
import { organisations, type Organisation } from '../db/schema';
import { advancedStage } from '../stages';
import { logActivity } from './activities';

/** Manual or automatic stage change, always audited. */
export async function setOrgStage(
  db: Db,
  org: Organisation,
  stage: Stage,
  userId: string | null,
  opts: { lostReason?: string | null; auto?: boolean; reason?: string } = {},
): Promise<void> {
  if (org.stage === stage) return;
  await db
    .update(organisations)
    .set({ stage, lostReason: stage === 'lost' ? (opts.lostReason ?? org.lostReason) : org.lostReason })
    .where(eq(organisations.id, org.id));
  await logActivity(db, {
    organisationId: org.id,
    userId,
    type: 'stage_changed',
    payload: {
      from: org.stage,
      to: stage,
      auto: !!opts.auto,
      reason: opts.reason,
      lostReason: opts.lostReason,
    },
  });
}

/** Forward-only automatic stage movement (never out of lost/on_hold). */
export async function advanceOrg(
  db: Db,
  orgId: string,
  target: Stage,
  userId: string | null,
  reason: string,
): Promise<void> {
  const [org] = await db.select().from(organisations).where(eq(organisations.id, orgId));
  if (!org) return;
  const next = advancedStage(org.stage, target);
  if (next) await setOrgStage(db, org, next, userId, { auto: true, reason });
}

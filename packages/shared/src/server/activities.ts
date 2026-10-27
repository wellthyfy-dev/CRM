import type { Db } from '../db/client';
import { activities } from '../db/schema';

export interface ActivityInput {
  organisationId?: string | null;
  userId?: string | null;
  type: string;
  payload?: Record<string, unknown>;
}

/** Append to the audit log. Every state change must call this. */
export async function logActivity(db: Db, input: ActivityInput): Promise<void> {
  await db.insert(activities).values({
    organisationId: input.organisationId ?? null,
    userId: input.userId ?? null,
    type: input.type,
    payload: input.payload ?? {},
  });
}

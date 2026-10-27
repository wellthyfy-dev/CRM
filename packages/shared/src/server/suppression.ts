import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { suppressions } from '../db/schema';
import { normaliseEmail } from '../email';

export function emailHash(email: string): string {
  return createHash('sha256').update(normaliseEmail(email)).digest('hex');
}

export async function isSuppressed(db: Db, email: string): Promise<boolean> {
  const rows = await db
    .select({ id: suppressions.id })
    .from(suppressions)
    .where(eq(suppressions.emailHash, emailHash(email)))
    .limit(1);
  return rows.length > 0;
}

/** Add an address to the permanent opt-out list (idempotent). */
export async function suppress(db: Db, email: string, reason: string): Promise<void> {
  await db
    .insert(suppressions)
    .values({ emailHash: emailHash(email), reason })
    .onConflictDoNothing();
}

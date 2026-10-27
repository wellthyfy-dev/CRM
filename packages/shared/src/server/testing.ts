import { createDb, runMigrations, type DbHandle } from '../db/client';
import { seed } from '../db/seed';

/** Fresh in-memory Postgres (PGlite) with migrations and seed applied. For tests only. */
export async function createTestDb(): Promise<DbHandle> {
  const handle = await createDb('pglite://memory');
  await runMigrations(handle);
  await seed(handle.db);
  return handle;
}

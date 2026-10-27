import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export { schema };

/** Drizzle database bound to our schema; driver-agnostic (node-postgres in prod, PGlite in tests/e2e). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  close: () => Promise<void>;
  driver: 'pg' | 'pglite';
}

/** Locate the committed drizzle migrations (works from TS source, bundled dist output, or any cwd in the repo). */
export function resolveMigrationsFolder(): string {
  const candidates = [
    process.env.DRIZZLE_MIGRATIONS_DIR,
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle'),
    path.resolve(process.cwd(), 'packages/shared/drizzle'),
    path.resolve(process.cwd(), '../../packages/shared/drizzle'),
    path.resolve(process.cwd(), 'drizzle'),
  ].filter((c): c is string => !!c);
  const found = candidates.find((c) => fs.existsSync(path.join(c, 'meta', '_journal.json')));
  if (!found) throw new Error(`Drizzle migrations folder not found (tried: ${candidates.join(', ')})`);
  return found;
}

export function isPgliteUrl(url: string): boolean {
  return url.startsWith('pglite://');
}

/**
 * Create a database handle from DATABASE_URL.
 * - postgres://… / postgresql://… → node-postgres pool (Supabase)
 * - pglite://memory              → in-process in-memory Postgres (tests, e2e)
 * - pglite://./some/dir          → in-process Postgres persisted to a directory (local demo)
 */
export async function createDb(url: string, opts: { max?: number } = {}): Promise<DbHandle> {
  if (!url) throw new Error('DATABASE_URL is not set');
  if (isPgliteUrl(url)) {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const target = url.slice('pglite://'.length);
    const client = target === 'memory' || target === '' ? new PGlite() : new PGlite(target);
    const db = drizzle(client, { schema }) as unknown as Db;
    return { db, driver: 'pglite', close: () => client.close() };
  }
  const pg = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const pool = new pg.default.Pool({
    connectionString: url,
    max: opts.max ?? 10,
    ssl: /supabase\.(co|com)/.test(url) ? { rejectUnauthorized: false } : undefined,
  });
  const db = drizzle(pool, { schema }) as unknown as Db;
  return { db, driver: 'pg', close: () => pool.end() };
}

export async function runMigrations(handle: DbHandle): Promise<void> {
  if (handle.driver === 'pglite') {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- migrator expects the concrete PGlite db type
    await migrate(handle.db as any, { migrationsFolder: resolveMigrationsFolder() });
  } else {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- migrator expects the concrete node-postgres db type
    await migrate(handle.db as any, { migrationsFolder: resolveMigrationsFolder() });
  }
}

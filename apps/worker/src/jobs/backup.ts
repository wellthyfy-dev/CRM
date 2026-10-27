import { spawn } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { sql } from 'drizzle-orm';
import { istDateKey } from '@wellthyfy/shared';
import { logActivity, QUEUES, type FileStore } from '@wellthyfy/shared/server';
import type { JobDefinition, WorkerDeps } from '../runtime';

export const BACKUP_PREFIX = 'backups';
export const BACKUP_RETENTION_DAYS = 30;

const TABLES = [
  'profiles',
  'organisations',
  'contacts',
  'suppressions',
  'research',
  'programmes',
  'templates',
  'template_versions',
  'emails',
  'replies',
  'proposals',
  'activities',
  'settings',
  'ai_usage',
  'discovery_runs',
];

/** libpq environment variables for a postgres:// URL (keeps the password out of argv). */
export function pgEnv(databaseUrl: string): Record<string, string> {
  const u = new URL(databaseUrl);
  return {
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: u.pathname.replace(/^\//, '') || 'postgres',
    PGSSLMODE:
      u.searchParams.get('sslmode') ?? (/supabase\.(co|com)/.test(u.hostname) ? 'require' : 'prefer'),
  };
}

/** Run pg_dump (plain SQL) if the binary is available. Credentials go via env, never argv or logs. */
function pgDump(databaseUrl: string, bin = process.env.PG_DUMP_PATH || 'pg_dump'): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, ['--no-owner', '--no-privileges', '--schema=public', '--schema=pgboss'], {
        env: { ...process.env, ...pgEnv(databaseUrl) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      return resolve(null);
    }
    const chunks: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 ? Buffer.concat(chunks) : null));
  });
}

/** Portable fallback: every application table as JSON rows. */
async function jsonExport(deps: Pick<WorkerDeps, 'db'>): Promise<Buffer> {
  const out: Record<string, unknown[]> = {};
  for (const t of TABLES) {
    const res = await deps.db.execute(sql.raw(`select * from "${t}"`));
    out[t] = (res as unknown as { rows: unknown[] }).rows ?? [];
  }
  return Buffer.from(JSON.stringify({ exportedAt: new Date().toISOString(), tables: out }));
}

export async function pruneBackups(
  files: FileStore,
  now: Date,
  keepDays = BACKUP_RETENTION_DAYS,
): Promise<string[]> {
  const cutoff = istDateKey(new Date(now.getTime() - keepDays * 86400000));
  const old = (await files.list(BACKUP_PREFIX))
    .map((f) => f.name)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\./.test(name) && name.slice(0, 10) < cutoff)
    .map((name) => `${BACKUP_PREFIX}/${name}`);
  await files.remove(old);
  return old;
}

export async function runBackup(
  deps: Pick<WorkerDeps, 'db' | 'env' | 'logger' | 'now'> & { files: FileStore; dump?: typeof pgDump },
): Promise<{ key: string; bytes: number; format: 'sql' | 'json'; pruned: string[] }> {
  const day = istDateKey(deps.now());
  const dumped = deps.env.DATABASE_URL.startsWith('pglite://')
    ? null
    : await (deps.dump ?? pgDump)(deps.env.DATABASE_URL);
  const format = dumped ? 'sql' : 'json';
  const body = gzipSync(dumped ?? (await jsonExport(deps)));
  const key = `${BACKUP_PREFIX}/${day}.${format}.gz`;
  await deps.files.put(key, body, 'application/gzip');
  const pruned = await pruneBackups(deps.files, deps.now());
  await logActivity(deps.db, {
    type: 'backup_completed',
    payload: { key, bytes: body.length, format, pruned: pruned.length },
  });
  deps.logger.info({ key, bytes: body.length, format, pruned: pruned.length }, 'backup stored');
  return { key, bytes: body.length, format, pruned };
}

export const backupJob: JobDefinition = {
  queue: QUEUES.backup,
  cron: '30 2 * * *',
  retryLimit: 2,
  async handler(deps) {
    await runBackup({ ...deps, files: deps.files });
  },
};

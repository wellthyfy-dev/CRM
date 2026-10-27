import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { memoryFileStore } from '@wellthyfy/shared/server';
import { pgEnv, pruneBackups, runBackup } from '../src/jobs/backup';
import { createHarness, seedEmail } from './harness';

describe('nightly backup', () => {
  it('stores a gzipped export under backups/<IST date> and keeps 30 days', async () => {
    const now = new Date('2026-10-27T21:00:00Z'); // 28 Oct 02:30 IST
    const h = await createHarness(now);
    await seedEmail(h);
    const files = memoryFileStore();
    await files.put('backups/2026-09-01.json.gz', Buffer.from('old'), 'application/gzip');
    await files.put('backups/2026-10-20.json.gz', Buffer.from('recent'), 'application/gzip');
    const r = await runBackup({ ...h.deps, files });
    expect(r).toMatchObject({ key: 'backups/2026-10-28.json.gz', format: 'json' });
    const json = JSON.parse(gunzipSync(files.files.get(r.key)!).toString());
    expect(json.tables.organisations).toHaveLength(1);
    expect(json.tables.emails).toHaveLength(1);
    expect([...files.files.keys()].sort()).toEqual([
      'backups/2026-10-20.json.gz',
      'backups/2026-10-28.json.gz',
    ]);
  });

  it('uses pg_dump output when available', async () => {
    const now = new Date('2026-10-27T21:00:00Z');
    const h = await createHarness(now);
    const files = memoryFileStore();
    const r = await runBackup({
      ...h.deps,
      env: { ...h.deps.env, DATABASE_URL: 'postgresql://u:p@db.x.supabase.co:5432/postgres' },
      files,
      dump: async () => Buffer.from('-- PostgreSQL database dump'),
    });
    expect(r.format).toBe('sql');
    expect(gunzipSync(files.files.get(r.key)!).toString()).toContain('PostgreSQL database dump');
  });

  it('prunes only dated backup files older than the retention window', async () => {
    const files = memoryFileStore();
    for (const k of ['2026-08-01.sql.gz', '2026-09-29.sql.gz', 'notes.txt'])
      await files.put(`backups/${k}`, Buffer.from('x'), 'x');
    const pruned = await pruneBackups(files, new Date('2026-10-28T00:00:00Z'));
    expect(pruned).toEqual(['backups/2026-08-01.sql.gz']);
  });

  it('builds libpq env vars from the URL', () => {
    expect(
      pgEnv('postgresql://postgres.abc:p%40ss@aws-0-ap-south-1.pooler.supabase.com:5432/postgres'),
    ).toEqual({
      PGHOST: 'aws-0-ap-south-1.pooler.supabase.com',
      PGPORT: '5432',
      PGUSER: 'postgres.abc',
      PGPASSWORD: 'p@ss',
      PGDATABASE: 'postgres',
      PGSSLMODE: 'require',
    });
  });
});

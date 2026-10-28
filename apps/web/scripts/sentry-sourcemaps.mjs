// Post-build: upload browser source maps to Sentry, then delete them so they are not served publicly.
// Upload runs only when SENTRY_AUTH_TOKEN is set (e.g. on Vercel); without it the maps are just removed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const staticDir = path.resolve(import.meta.dirname, '../.next/static');
const org = process.env.SENTRY_ORG || 'wellthyfy';
const project = process.env.SENTRY_PROJECT || 'wellthyfy-web';

function sentryCli(args) {
  const res = spawnSync('sentry-cli', args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (res.status !== 0) throw new Error(`sentry-cli ${args[0]} ${args[1]} failed`);
}

function removeMaps(dir) {
  let removed = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) removed += removeMaps(p);
    else if (entry.name.endsWith('.map')) {
      fs.rmSync(p);
      removed++;
    }
  }
  return removed;
}

if (!fs.existsSync(staticDir)) {
  console.log('[sentry] no .next/static directory; skipping');
  process.exit(0);
}

if (process.env.SENTRY_AUTH_TOKEN) {
  // inject first (Debug IDs in both the chunk and its map), then upload.
  sentryCli(['sourcemaps', 'inject', staticDir]);
  sentryCli(['sourcemaps', 'upload', '--org', org, '--project', project, staticDir]);
} else {
  console.log('[sentry] SENTRY_AUTH_TOKEN not set; source maps not uploaded');
}
console.log(`[sentry] removed ${removeMaps(staticDir)} .map files from the public build`);

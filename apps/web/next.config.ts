import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

const repoRoot = path.resolve(import.meta.dirname, '../..');

// Read NEXT_PUBLIC_* values from the repo-root .env (shared with api + worker). Never overrides real env vars.
// forceReload: Next has already loaded (and cached) apps/web's own env files by the time this config runs.
const { combinedEnv } = loadEnvConfig(repoRoot, process.env.NODE_ENV !== 'production', undefined, true);
const publicEnv = Object.fromEntries(
  Object.entries(combinedEnv).filter(
    (e): e is [string, string] => e[0].startsWith('NEXT_PUBLIC_') && typeof e[1] === 'string',
  ),
);

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  // The shared workspace package ships TypeScript source.
  transpilePackages: ['@wellthyfy/shared'],
  // Inline the root .env's browser values even if Next later reloads its own env files.
  env: publicEnv,
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  productionBrowserSourceMaps: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;

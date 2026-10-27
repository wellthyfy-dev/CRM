import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

let loaded = false;

/** Load the repo-root .env (if present) without overriding variables already set in the environment. */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) {
      for (const line of fs.readFileSync(candidate, 'utf8').split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (!m || line.trimStart().startsWith('#')) continue;
        const key = m[1] as string;
        let value = (m[2] ?? '').trim();
        if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
        if (process.env[key] === undefined) process.env[key] = value;
      }
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

export const serverEnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SUPABASE_URL: optional,
  SUPABASE_ANON_KEY: optional,
  SUPABASE_SERVICE_ROLE_KEY: optional,
  SUPABASE_JWT_SECRET: optional,
  SUPABASE_STORAGE_BUCKET: z.string().default('wellthyfy-crm'),
  TITAN_USER: optional,
  TITAN_PASSWORD: optional,
  TITAN_FROM_NAME: z.string().default('Selvaganapathy V. | Wellthyfy Lifestyle Ventures'),
  EMAIL_MODE: z.enum(['dry_run', 'live']).default('dry_run'),
  RESEND_API_KEY: optional,
  RESEND_FROM: optional,
  ALERT_EMAIL_TO: optional,
  ANTHROPIC_API_KEY: optional,
  AI_MODEL_DEFAULT: z.string().default('claude-haiku-5-5'),
  AI_MODEL_OPTIONAL: z.string().default('claude-sonnet-5-5'),
  USD_TO_INR: z.coerce.number().positive().default(88),
  SERPER_API_KEY: optional,
  ZEROBOUNCE_API_KEY: optional,
  SENTRY_DSN: optional,
  SENTRY_ENVIRONMENT: z.string().default('development'),
  APP_URL: z.string().default('http://localhost:5173'),
  API_URL: z.string().default('http://localhost:4000'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.string().default('info'),
  TZ: z.string().default('Asia/Kolkata'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function readServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  // Empty strings in .env mean "unset"; strip them so defaults apply.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const parsed = serverEnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
}

/** Names of env vars that must never be logged or returned to the browser. */
export const SECRET_ENV_KEYS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_JWT_SECRET',
  'DATABASE_URL',
  'TITAN_PASSWORD',
  'RESEND_API_KEY',
  'ANTHROPIC_API_KEY',
  'SERPER_API_KEY',
  'ZEROBOUNCE_API_KEY',
] as const;

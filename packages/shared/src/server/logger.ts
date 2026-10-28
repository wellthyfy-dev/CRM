import pino from 'pino';

// Structured logger with secret redaction. Never pass credentials to log calls; redaction is a second line of defence.
export const REDACT_PATHS = [
  'password',
  '*.password',
  'pass',
  '*.pass',
  'auth.pass',
  '*.auth.pass',
  'authorization',
  '*.authorization',
  'headers.authorization',
  'req.headers.authorization',
  'req.headers.cookie',
  'token',
  '*.token',
  'apiKey',
  '*.apiKey',
  'api_key',
  '*.api_key',
  'TITAN_PASSWORD',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
];

export function createLogger(name: string, level = process.env.LOG_LEVEL ?? 'info') {
  return pino({
    name,
    level: process.env.NODE_ENV === 'test' || process.env.VITEST ? 'silent' : level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  });
}

export type Logger = ReturnType<typeof createLogger>;

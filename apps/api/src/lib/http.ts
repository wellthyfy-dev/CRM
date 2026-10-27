import type { Request, RequestHandler } from 'express';
import type { z } from 'zod';
import { uuidParam } from '@wellthyfy/shared';
import type { Logger } from '@wellthyfy/shared/server';

export function parseBody<S extends z.ZodType>(schema: S, req: Request): z.infer<S> {
  return schema.parse(req.body ?? {});
}

export function parseQuery<S extends z.ZodType>(schema: S, req: Request): z.infer<S> {
  return schema.parse(req.query ?? {});
}

export function idParam(req: Request, name = 'id'): string {
  return uuidParam.parse(req.params[name]);
}

/** Request log line: method, path (no query string), status, duration, user id. Never bodies or headers. */
export function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      logger.info(
        {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ms: Math.round(ms),
          userId: req.user?.id,
        },
        'request',
      );
    });
    next();
  };
}

/** Escape a value for CSV output. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s =
    value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.join('; ') : String(value);
  // Neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n');
}

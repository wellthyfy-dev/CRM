import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import type { Logger } from '@wellthyfy/shared/server';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const forbidden = (message = 'Forbidden') => new HttpError(403, message);
export const notFound = (message = 'Not found') => new HttpError(404, message);
export const conflict = (message: string, details?: unknown) => new HttpError(409, message, details);

/** Postgres unique-violation → 409 instead of 500. */
function pgUniqueViolation(err: unknown): { constraint?: string } | null {
  const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  if (e?.code === '23505') return { constraint: e.constraint };
  if (e?.cause?.code === '23505') return { constraint: e.cause.constraint };
  return null;
}

export function errorHandler(logger: Logger, onUnexpected?: (err: unknown) => void): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: 'Validation failed',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, details: err.details });
      return;
    }
    const unique = pgUniqueViolation(err);
    if (unique) {
      res.status(409).json({ error: 'Duplicate record', details: unique });
      return;
    }
    if ((err as { type?: string })?.type === 'entity.too.large') {
      res.status(413).json({ error: 'Request too large' });
      return;
    }
    logger.error(
      { err: (err as Error)?.message, stack: (err as Error)?.stack, path: req.path },
      'unhandled error',
    );
    onUnexpected?.(err);
    res.status(500).json({ error: 'Internal server error' });
  };
}

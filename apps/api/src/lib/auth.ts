import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';
import { eq } from 'drizzle-orm';
import type { Role } from '@wellthyfy/shared';
import { profiles, type Db, type ServerEnv } from '@wellthyfy/shared/server';
import { forbidden, HttpError } from './errors';

export interface AuthUser {
  id: string;
  email: string | null;
  fullName: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express request augmentation
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export type TokenVerifier = (token: string) => Promise<JWTPayload & { sub: string }>;

/**
 * Verify Supabase access tokens. HS256 tokens use the legacy SUPABASE_JWT_SECRET; asymmetric tokens (ES256/RS256,
 * Supabase's current signing keys) use the project's JWKS. A project can have both, so pick by the token's `alg`.
 * Audience must be "authenticated".
 */
export function createTokenVerifier(
  env: Pick<ServerEnv, 'SUPABASE_JWT_SECRET' | 'SUPABASE_URL'>,
): TokenVerifier {
  const opts = { audience: 'authenticated' };
  const secret = env.SUPABASE_JWT_SECRET ? new TextEncoder().encode(env.SUPABASE_JWT_SECRET) : null;
  const jwks = env.SUPABASE_URL
    ? createRemoteJWKSet(new URL(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`))
    : null;
  if (!secret && !jwks) {
    return async () => {
      throw new Error('Auth is not configured (set SUPABASE_URL or SUPABASE_JWT_SECRET)');
    };
  }
  return async (token) => {
    const { alg } = decodeProtectedHeader(token);
    let payload: JWTPayload;
    if (alg === 'HS256') {
      if (!secret) throw new Error('HS256 token but SUPABASE_JWT_SECRET is not set');
      ({ payload } = await jwtVerify(token, secret, { ...opts, algorithms: ['HS256'] }));
    } else {
      if (!jwks) throw new Error('Asymmetric token but SUPABASE_URL is not set');
      ({ payload } = await jwtVerify(token, jwks, { ...opts, algorithms: ['ES256', 'RS256'] }));
    }
    if (!payload.sub) throw new Error('Token has no subject');
    return payload as JWTPayload & { sub: string };
  };
}

/** Verify the bearer token on every request and load the role from `profiles`. */
export function requireAuth(db: Db, verify: TokenVerifier): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return next(new HttpError(401, 'Missing bearer token'));
    let sub: string;
    try {
      sub = (await verify(token)).sub;
    } catch {
      return next(new HttpError(401, 'Invalid or expired token'));
    }
    const [profile] = await db.select().from(profiles).where(eq(profiles.id, sub));
    if (!profile) return next(forbidden('No CRM profile for this user. Ask an admin to invite you.'));
    if (!profile.active) return next(forbidden('Your account has been deactivated.'));
    req.user = { id: profile.id, email: profile.email, fullName: profile.fullName, role: profile.role };
    next();
  };
}

/** Allow only the given roles. Admin is always allowed. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    const role = req.user?.role;
    if (!role) return next(new HttpError(401, 'Not authenticated'));
    if (role === 'admin' || roles.includes(role)) return next();
    next(forbidden(`This action requires role: ${['admin', ...roles].join(' or ')}`));
  };
}

/** Write access for organisations, contacts, research and drafts. */
export const canEdit = requireRole('researcher');
/** Admin-only: approve, send, settings, users. */
export const adminOnly = requireRole();

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new HttpError(401, 'Not authenticated');
  return req.user;
}

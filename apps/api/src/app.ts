import cors from 'cors';
import express, { Router } from 'express';
import type { Db, JobPublisher, Logger, ServerEnv } from '@wellthyfy/shared/server';
import { requireAuth, type TokenVerifier } from './lib/auth';
import { errorHandler } from './lib/errors';
import { rateLimit, securityHeaders } from './lib/hardening';
import { requestLogger } from './lib/http';
import type { Services } from './lib/services';
import { healthRoutes } from './routes/health';
import { registerApiRoutes } from './routes';

export interface AppDeps {
  db: Db;
  env: ServerEnv;
  logger: Logger;
  publisher: JobPublisher;
  verifyToken: TokenVerifier;
  services: Services;
  now?: () => Date;
  onUnexpectedError?: (err: unknown) => void;
}

export type RouteDeps = AppDeps & { now: () => Date };

export function createApp(deps: AppDeps) {
  const full: RouteDeps = { ...deps, now: deps.now ?? (() => new Date()) };
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(securityHeaders(deps.env.NODE_ENV === 'production'));

  const origins = deps.env.APP_URL.split(',').map((o) => o.trim().replace(/\/$/, ''));
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || origins.includes(origin.replace(/\/$/, ''))),
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '10mb' }));
  app.use(requestLogger(deps.logger));

  app.use(healthRoutes(full));

  const api = Router();
  api.use(rateLimit({ windowMs: 60_000, max: deps.env.NODE_ENV === 'test' ? 100_000 : 600 }));
  api.use(requireAuth(deps.db, deps.verifyToken));
  registerApiRoutes(api, full);
  app.use('/api', api);

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(errorHandler(deps.logger, deps.onUnexpectedError));
  return app;
}

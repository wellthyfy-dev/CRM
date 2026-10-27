import { Router } from 'express';
import type { RouteDeps } from '../app';
import { currentUser } from '../lib/auth';

export function meRoutes({ env }: RouteDeps): Router {
  const r = Router();
  r.get('/me', (req, res) => {
    res.json({ user: currentUser(req), emailMode: env.EMAIL_MODE });
  });
  return r;
}

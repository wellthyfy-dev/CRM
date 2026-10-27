import type { Router } from 'express';
import type { RouteDeps } from '../app';
import { meRoutes } from './me';

/** Mount every authenticated /api router. Each router applies its own role guards per route. */
export function registerApiRoutes(api: Router, deps: RouteDeps): void {
  api.use(meRoutes(deps));
}

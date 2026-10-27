import type { Router } from 'express';
import type { RouteDeps } from '../app';
import { contactRoutes } from './contacts';
import { emailRoutes } from './emails';
import { importRoutes } from './import';
import { meRoutes } from './me';
import { organisationRoutes } from './organisations';
import { pipelineRoutes } from './pipeline';
import { programmeRoutes } from './programmes';
import { researchRoutes } from './research';
import { sendingRoutes } from './sending';
import { settingsRoutes } from './settings';
import { templateRoutes } from './templates';
import { userRoutes } from './users';

/** Mount every authenticated /api router. Each router applies its own role guards per route. */
export function registerApiRoutes(api: Router, deps: RouteDeps): void {
  api.use(meRoutes(deps));
  api.use(organisationRoutes(deps));
  api.use(contactRoutes(deps));
  api.use(researchRoutes(deps));
  api.use(programmeRoutes(deps));
  api.use(templateRoutes(deps));
  api.use(sendingRoutes(deps));
  api.use(emailRoutes(deps));
  api.use(importRoutes(deps));
  api.use(pipelineRoutes(deps));
  api.use(userRoutes(deps));
  api.use(settingsRoutes(deps));
}

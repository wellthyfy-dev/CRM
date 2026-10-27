import type { JobDefinition } from '../runtime';
import { heartbeatJob } from './heartbeat';

export const ALL_JOBS: JobDefinition[] = [heartbeatJob];

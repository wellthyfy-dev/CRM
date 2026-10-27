import type { JobDefinition } from '../runtime';
import { heartbeatJob } from './heartbeat';
import { imapDraftJob } from './imap-draft';
import { verifyEmailJob } from './verify-email';

export const ALL_JOBS: JobDefinition[] = [heartbeatJob, imapDraftJob, verifyEmailJob];

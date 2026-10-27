import type { JobDefinition } from '../runtime';
import { aiResearchJob } from './ai-research';
import { discoveryJob } from './discovery';
import { followUpsJob } from './follow-ups';
import { heartbeatJob } from './heartbeat';
import { imapDraftJob } from './imap-draft';
import { imapPollJob } from './imap-poll';
import { digestJob, replyAlertJob } from './notifications';
import { sendTickJob } from './send';
import { verifyEmailJob } from './verify-email';

export const ALL_JOBS: JobDefinition[] = [
  heartbeatJob,
  imapDraftJob,
  verifyEmailJob,
  sendTickJob,
  followUpsJob,
  imapPollJob,
  aiResearchJob,
  digestJob,
  replyAlertJob,
  discoveryJob,
];

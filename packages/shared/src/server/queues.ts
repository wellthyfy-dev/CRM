// pg-boss queue names shared by the api (publisher) and worker (consumer).
export const QUEUES = {
  heartbeat: 'heartbeat',
  imapDraft: 'imap-draft',
  sendTick: 'send-tick',
  followUps: 'follow-ups',
  imapPoll: 'imap-poll',
  verifyEmail: 'verify-email',
  aiResearch: 'ai-research',
  digest: 'daily-digest',
  replyAlert: 'reply-alert',
  discovery: 'discovery',
  backup: 'nightly-backup',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Minimal publisher interface so the API can enqueue without depending on pg-boss in tests. */
export interface JobPublisher {
  send(
    queue: QueueName,
    data: Record<string, unknown>,
    options?: { startAfterSeconds?: number; singletonKey?: string },
  ): Promise<void>;
}

export class RecordingPublisher implements JobPublisher {
  readonly jobs: { queue: QueueName; data: Record<string, unknown> }[] = [];
  async send(queue: QueueName, data: Record<string, unknown>): Promise<void> {
    this.jobs.push({ queue, data });
  }
}

import { randomUUID } from 'node:crypto';
import type { EmailCheckStatus } from '@wellthyfy/shared';
import { memoryFileStore, type ConnectionTestResult } from '@wellthyfy/shared/server';
import type { Services } from './services';

/** In-memory fakes for external services (tests and PGlite demo mode). Never touch the network. */
export function createFakeServices() {
  const invited: { email: string; fullName: string; id: string }[] = [];
  const verifications: string[] = [];
  const state = {
    verifierConfigured: false,
    nextVerification: 'valid' as EmailCheckStatus,
    titanResult: { imap: 'fail', smtp: 'fail' } as ConnectionTestResult,
  };
  const services = {
    invited,
    verifications,
    state,
    users: {
      async invite(email: string, fullName: string) {
        const id = randomUUID();
        invited.push({ email, fullName, id });
        return { id };
      },
    },
    emailVerifier: {
      get configured() {
        return state.verifierConfigured;
      },
      async verify(email: string) {
        verifications.push(email);
        return state.nextVerification;
      },
    },
    titan: {
      async testConnection() {
        return state.titanResult;
      },
    },
    files: memoryFileStore(),
  } satisfies Services & Record<string, unknown>;
  return services;
}

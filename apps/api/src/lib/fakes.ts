import { randomUUID } from 'node:crypto';
import type { Services } from './services';

/** In-memory fakes for external services (tests and PGlite demo mode). Never touch the network. */
export function createFakeServices() {
  const invited: { email: string; fullName: string; id: string }[] = [];
  const services = {
    invited,
    users: {
      async invite(email: string, fullName: string) {
        const id = randomUUID();
        invited.push({ email, fullName, id });
        return { id };
      },
    },
  } satisfies Services & { invited: unknown };
  return services;
}

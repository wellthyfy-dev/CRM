import { profiles, type Db } from '@wellthyfy/shared/server';

/** Fixed users for Playwright (PGlite mode only; enabled with E2E_SEED_USERS=1). */
export const E2E_USERS = {
  admin: {
    id: '00000000-0000-4000-8000-0000000000e1',
    email: 'e2e-admin@wellthyfy.in',
    fullName: 'E2E Admin',
  },
  researcher: {
    id: '00000000-0000-4000-8000-0000000000e2',
    email: 'e2e-research@wellthyfy.in',
    fullName: 'E2E Researcher',
  },
  viewer: {
    id: '00000000-0000-4000-8000-0000000000e3',
    email: 'e2e-viewer@wellthyfy.in',
    fullName: 'E2E Viewer',
  },
} as const;

export async function seedE2eUsers(db: Db): Promise<void> {
  for (const [role, u] of Object.entries(E2E_USERS)) {
    await db
      .insert(profiles)
      .values({ ...u, role: role as keyof typeof E2E_USERS, active: true })
      .onConflictDoNothing();
  }
}

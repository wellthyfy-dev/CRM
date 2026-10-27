import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import { SignJWT } from 'jose';
import { E2E_API_URL, E2E_JWT_SECRET } from '../playwright.config';

export type Role = 'admin' | 'researcher' | 'viewer';

export const USERS: Record<Role, { id: string; email: string; fullName: string }> = {
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
};

export async function tokenFor(role: Role): Promise<string> {
  return new SignJWT({ role: 'authenticated', email: USERS[role].email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(USERS[role].id)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(new TextEncoder().encode(E2E_JWT_SECRET));
}

/** Sign in by seeding the supabase-js session in localStorage (no Supabase server in e2e). */
export async function loginAs(page: Page, role: Role): Promise<void> {
  const token = await tokenFor(role);
  const now = Math.floor(Date.now() / 1000);
  const session = {
    access_token: token,
    token_type: 'bearer',
    expires_in: 7200,
    expires_at: now + 7200,
    refresh_token: 'e2e-refresh',
    user: {
      id: USERS[role].id,
      aud: 'authenticated',
      role: 'authenticated',
      email: USERS[role].email,
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
  await page.addInitScript((value) => {
    window.localStorage.setItem('sb-localhost-auth-token', value);
  }, JSON.stringify(session));
}

/** Direct API client for arranging test data. */
export class Api {
  constructor(
    private readonly request: APIRequestContext,
    private readonly role: Role,
  ) {}

  private async headers() {
    return { Authorization: `Bearer ${await tokenFor(this.role)}` };
  }

  async post<T = Record<string, unknown>>(path: string, data: unknown = {}): Promise<T> {
    const res = await this.request.post(`${E2E_API_URL}${path}`, { data, headers: await this.headers() });
    expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
    return (await res.json()) as T;
  }

  async raw(method: 'POST' | 'PATCH', path: string, data: unknown = {}) {
    return this.request.fetch(`${E2E_API_URL}${path}`, { method, data, headers: await this.headers() });
  }

  async patch<T = Record<string, unknown>>(path: string, data: unknown = {}): Promise<T> {
    const res = await this.raw('PATCH', path, data);
    expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
    return (await res.json()) as T;
  }
}

let seq = 0;
export function unique(prefix: string): string {
  seq++;
  return `${prefix}${Date.now().toString(36)}${seq}`;
}

/** Organisation + contact (optionally verified) created through the API as a researcher. */
export async function arrangeOrgWithContact(api: Api, opts: { verified?: boolean; name?: string } = {}) {
  const slug = unique('c');
  const org = await api.post<{ id: string; recordId: string; name: string }>('/api/organisations', {
    name: opts.name ?? `E2E College ${slug}`,
    orgType: 'college_university',
    segment: 'arts_science',
    city: 'Chennai',
    state: 'Tamil Nadu',
    website: `https://${slug}.ac.in`,
  });
  const contact = await api.post<{ id: string; email: string }>(`/api/organisations/${org.id}/contacts`, {
    fullName: 'Dr. E2E Principal',
    designation: 'Principal',
    email: `principal@${slug}.ac.in`,
    sourceUrl: `https://${slug}.ac.in/principal`,
  });
  if (opts.verified) await api.post(`/api/contacts/${contact.id}/verify`);
  return { org, contact };
}

export const test = base.extend<{ researcherApi: Api; adminApi: Api }>({
  researcherApi: async ({ request }, use) => use(new Api(request, 'researcher')),
  adminApi: async ({ request }, use) => use(new Api(request, 'admin')),
});

export { expect };

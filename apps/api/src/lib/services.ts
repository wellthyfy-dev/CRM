import { supabaseAdmin, type ServerEnv } from '@wellthyfy/shared/server';

// External integrations behind interfaces, so routes are testable without network access.

export interface UserDirectory {
  /** Invite a user by email via Supabase Auth; returns the auth user id. */
  invite(email: string, fullName: string): Promise<{ id: string }>;
}

export interface Services {
  users: UserDirectory;
}

export function supabaseUserDirectory(env: ServerEnv): UserDirectory {
  return {
    async invite(email, fullName) {
      const { data, error } = await supabaseAdmin().auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName },
        redirectTo: `${env.APP_URL.split(',')[0]}/login`,
      });
      if (error || !data.user) throw new Error(error?.message ?? 'Invite failed');
      return { id: data.user.id };
    },
  };
}

export function createServices(env: ServerEnv): Services {
  return { users: supabaseUserDirectory(env) };
}

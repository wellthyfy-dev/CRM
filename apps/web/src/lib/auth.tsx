import * as React from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Role } from '@wellthyfy/shared';
import { api, ApiError } from './api';
import { supabase } from './supabase';

export interface Me {
  id: string;
  email: string | null;
  fullName: string;
  role: Role;
}

interface AuthState {
  session: Session | null;
  me: Me | null;
  emailMode: 'dry_run' | 'live' | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = React.createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<Session | null>(null);
  const [me, setMe] = React.useState<Me | null>(null);
  const [emailMode, setEmailMode] = React.useState<'dry_run' | 'live' | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const loadMe = React.useCallback(async (s: Session | null) => {
    if (!s) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      const res = await api<{ user: Me; emailMode: 'dry_run' | 'live' }>('/api/me');
      setMe(res.user);
      setEmailMode(res.emailMode);
      setError(null);
    } catch (e) {
      setMe(null);
      setError(e instanceof ApiError ? e.message : 'Could not reach the API');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      void loadMe(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') void loadMe(s);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadMe]);

  const value: AuthState = {
    session,
    me,
    emailMode,
    loading,
    error,
    async signIn(email, password) {
      setError(null);
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) throw new Error(err.message);
    },
    async signOut() {
      await supabase.auth.signOut();
      setMe(null);
    },
    refresh: () => loadMe(session),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function useRole() {
  const { me } = useAuth();
  const role = me?.role ?? 'viewer';
  return {
    role,
    isAdmin: role === 'admin',
    canEdit: role === 'admin' || role === 'researcher',
  };
}

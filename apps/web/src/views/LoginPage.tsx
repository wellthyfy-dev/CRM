import * as React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { SENDER } from '@wellthyfy/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { useAuth } from '@/lib/auth';
import { supabaseConfigured } from '@/lib/supabase';

export function LoginPage() {
  const { me, session, signIn, signOut, error: authError, loading } = useAuth();
  const location = useLocation();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (me) {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Wellthyfy Outreach CRM</CardTitle>
          <CardDescription>{SENDER.tagline}</CardDescription>
        </CardHeader>
        <CardContent>
          {!supabaseConfigured && (
            <p className="mb-3 rounded-md bg-amber-100 p-2 text-xs text-amber-900">
              Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.
            </p>
          )}
          {session && !loading && authError && (
            <div className="mb-3 rounded-md bg-red-100 p-2 text-xs text-red-800">
              {authError}{' '}
              <button className="underline" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
          )}
          <form onSubmit={submit} className="grid gap-3">
            <Field label="Email">
              <Input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
            <p className="text-center text-xs text-muted-foreground">Access is by invitation only.</p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

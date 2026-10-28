import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { SENDER } from '@wellthyfy/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { useAuth } from '@/lib/auth';
import { supabaseConfigured } from '@/lib/supabase';

export function LoginPage() {
  const { me, session, signIn, signOut, error: authError, loading } = useAuth();
  const router = useRouter();
  const from = safeRedirect(useSearchParams().get('from'));
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (me) router.replace(from);
  }, [me, from, router]);

  if (me) return null;

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
              Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in
              .env.
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
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
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

/** Only same-app paths are allowed as a post-login target (no open redirects via ?from=). */
function safeRedirect(from: string | null): string {
  return from && from.startsWith('/') && !from.startsWith('//') ? from : '/';
}

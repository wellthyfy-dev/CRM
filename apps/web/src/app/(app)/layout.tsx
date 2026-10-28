'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { useAuth } from '@/lib/auth';
import { canAccess } from '@/lib/nav';

/** Signed-in area: requires a CRM profile and a role allowed on the current path. */
export default function AuthedLayout({ children }: { children: React.ReactNode }) {
  const { me, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  React.useEffect(() => {
    if (!loading && !me) router.replace(`/login?from=${encodeURIComponent(pathname)}`);
  }, [loading, me, pathname, router]);

  if (loading || !me) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  return (
    <AppShell>
      {canAccess(pathname, me.role) ? (
        children
      ) : (
        <div className="p-8 text-sm text-destructive">You do not have access to this page.</div>
      )}
    </AppShell>
  );
}

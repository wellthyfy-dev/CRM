import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { SENDER } from '@wellthyfy/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { navFor } from '@/lib/nav';
import { cn } from '@/lib/utils';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { me, signOut, emailMode } = useAuth();
  const pathname = usePathname();
  if (!me) return null;
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r bg-card">
        <div className="border-b px-4 py-3">
          <div className="text-sm font-bold text-primary">Wellthyfy Outreach</div>
          <div className="truncate text-[11px] text-muted-foreground">{SENDER.company}</div>
        </div>
        <nav className="flex-1 overflow-y-auto p-2" aria-label="Main">
          {navFor(me.role).map((item) => (
            <Link
              key={item.to}
              href={item.to}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                isNavActive(item.to, pathname) && 'bg-accent font-medium text-accent-foreground',
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t p-3 text-xs">
          <div className="truncate font-medium" data-testid="current-user">
            {me.fullName || me.email}
          </div>
          <div className="mb-2 flex items-center gap-1 text-muted-foreground">
            <span className="capitalize" data-testid="current-role">
              {me.role}
            </span>
            {emailMode && (
              <Badge variant={emailMode === 'live' ? 'danger' : 'secondary'} className="ml-auto">
                {emailMode === 'live' ? 'LIVE email' : 'dry run'}
              </Badge>
            )}
          </div>
          <Button variant="outline" size="sm" className="w-full" onClick={() => void signOut()}>
            <LogOut /> Sign out
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}

function isNavActive(to: string, pathname: string): boolean {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

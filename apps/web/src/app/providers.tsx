'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Sentry from '@sentry/react';
import { AuthProvider } from '@/lib/auth';
import { ToastProvider } from '@/components/ui/toast';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn && typeof window !== 'undefined') {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    // Vercel exposes the deployed commit to the browser build.
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: 0,
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <Sentry.ErrorBoundary fallback={<div className="p-8 text-sm">Something went wrong. Please reload.</div>}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </Sentry.ErrorBoundary>
  );
}

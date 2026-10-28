import * as React from 'react';
import type { Metadata } from 'next';
import { Providers } from './providers';
import '@/index.css';

export const metadata: Metadata = {
  title: 'Wellthyfy Outreach CRM',
  icons: { icon: '/favicon.svg' },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          {/* Client pages read search params; the boundary lets Next prerender the static shell. */}
          <React.Suspense>{children}</React.Suspense>
        </Providers>
      </body>
    </html>
  );
}

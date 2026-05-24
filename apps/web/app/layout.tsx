import './globals.css';
import type { ReactNode } from 'react';
import { fraunces, geist, geistMono } from '@/lib/fonts';

export const metadata = {
  title: "Crawlmouse — Grade your site's internal linking",
  description: 'Free, no-install, instantly-shareable internal-linking grader for any website.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${geist.variable} ${geistMono.variable}`}>
      <body className="bg-cream text-ink font-sans antialiased">{children}</body>
    </html>
  );
}

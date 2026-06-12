import './globals.css';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { fraunces, geist, geistMono } from '@/lib/fonts';
import { TrpcProvider } from '@/lib/trpc/Provider';
import { CookieConsent } from '@/components/consent/CookieConsent';
import { siteOrigin } from '@/lib/site-url';
import { JsonLd, organizationLd } from '@/lib/seo/jsonld';

const TITLE = "Crawlmouse — Grade your site's internal linking";
const DESCRIPTION =
  'Free, no-install internal-linking grader for any website. Find orphan pages, weak hubs, and pages ' +
  'buried too deep — and get a clear A–F grade in seconds.';

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  title: { default: TITLE, template: '%s · Crawlmouse' },
  description: DESCRIPTION,
  applicationName: 'Crawlmouse',
  keywords: [
    'internal linking',
    'internal link checker',
    'internal link audit',
    'orphan pages',
    'site structure',
    'crawl depth',
    'SEO audit',
  ],
  authors: [{ name: 'Nahl Technologies Inc' }],
  creator: 'Nahl Technologies Inc',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'Crawlmouse',
    title: TITLE,
    description: DESCRIPTION,
    url: siteOrigin(),
    locale: 'en_US',
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1, 'max-video-preview': -1 },
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${geist.variable} ${geistMono.variable}`}>
      <body className="bg-cream text-ink font-sans antialiased">
        <JsonLd data={organizationLd()} />
        <TrpcProvider>{children}</TrpcProvider>
        <CookieConsent />
      </body>
    </html>
  );
}

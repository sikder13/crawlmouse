import type { Metadata } from 'next';
import { V1NotFound } from '@/components/layout/V1NotFound';
import { NotFoundIsland } from '@/components/v2/screens/not-found/NotFoundIsland';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { NOT_FOUND_COPY } from '@/lib/v2/copy/not-found';

/** A 404 is no page of the site: it takes neither the home's title nor its canonical. */
export const metadata: Metadata = {
  title: 'Page not found',
  description: NOT_FOUND_COPY.lead,
  alternates: { canonical: null },
  robots: { index: false, follow: true },
  // Empty, not null: Next re-applies the root's opengraph-image over a null.
  openGraph: { images: [] },
  twitter: { images: [] },
};

/** The v2 404 while V2_CHECKS_PUBLIC serves the v2 site (RC-20); v1's with the flag off. */
export default function NotFound() {
  if (checksPublicEnabled()) return <NotFoundIsland />;
  return <V1NotFound />;
}

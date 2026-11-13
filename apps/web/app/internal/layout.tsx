import '../../styles/v2/tokens.css';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';

// The support console (CC-33 D2): staff only, and a 404 for anyone else (each page decides that
// itself, before it reads anything). Never a search result, and left out of the sitemap.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Support console',
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

export default function InternalLayout({ children }: { children: ReactNode }) {
  return children;
}

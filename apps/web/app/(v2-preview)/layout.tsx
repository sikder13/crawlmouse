import '../../styles/v2/tokens.css';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

// Development-only previews of the v2 design system. Never indexed, and a 404 in production.
export const metadata: Metadata = {
  title: 'v2 preview',
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

export default function V2PreviewLayout({ children }: { children: ReactNode }) {
  // Read at render time, so the check cannot be frozen into a module that was loaded earlier.
  if (process.env.NODE_ENV === 'production') notFound();
  return children;
}

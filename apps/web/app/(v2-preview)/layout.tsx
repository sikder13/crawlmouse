import '../../styles/v2/tokens.css';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { previewOnly } from './v2-preview/_preview/guard';

// Development-only previews of the v2 design system. Never indexed, and a 404 in production.
export const metadata: Metadata = {
  title: 'v2 preview',
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

export default function V2PreviewLayout({ children }: { children: ReactNode }) {
  previewOnly();
  return children;
}

import '../../styles/v2/tokens.css';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';

// The account door's pages (CC-25): Sign-up, Check your email, and the sign-in landing's Continue
// page. The first live pages built on the v2 design system, so this layout brings in its tokens.
// None is indexed in this step (D9): the route decides indexing, never a component, and CC-29 makes
// /signup indexable with its copy review. The root layout's canonical ("/") would be wrong on each.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

export default function AccountLayout({ children }: { children: ReactNode }) {
  return children;
}

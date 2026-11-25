import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { IdentifyPersonMount } from '@/components/analytics/IdentifyPersonMount';
import { checksPublicEnabled } from '@/lib/auth/flags';

// Signed-in pages: the browser is identified as the user (CC-41 D1). Every page under this layout
// answers 404 without V2_CHECKS_PUBLIC, and so does the layout.
export default function CompetitorsLayout({ children }: { children: ReactNode }) {
  if (!checksPublicEnabled()) return notFound();
  return (
    <>
      {children}
      <IdentifyPersonMount />
    </>
  );
}

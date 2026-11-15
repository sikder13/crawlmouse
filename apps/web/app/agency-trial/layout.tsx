import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { IdentifyPersonMount } from '@/components/analytics/IdentifyPersonMount';
import { billingV2Enabled } from '@/lib/billing/flags';

// Signed-in pages: the browser is identified as the user (CC-41 D1). The page under this layout
// answers 404 without V2_BILLING (app/agency-trial/page.tsx), and so does the layout.
export default function AgencyTrialLayout({ children }: { children: ReactNode }) {
  if (!billingV2Enabled()) return notFound();
  return (
    <>
      {children}
      <IdentifyPersonMount />
    </>
  );
}

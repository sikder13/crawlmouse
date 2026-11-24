import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { IdentifyPersonMount } from '@/components/analytics/IdentifyPersonMount';
import { billingV2Enabled } from '@/lib/billing/flags';

// Signed-in pages: the browser is identified as the user (CC-41 D1). Without V2_BILLING the layout,
// like the page under it, sends the visitor to For agencies (RC-01).
export default function AgencyTrialLayout({ children }: { children: ReactNode }) {
  if (!billingV2Enabled()) redirect('/agencies');
  return (
    <>
      {children}
      <IdentifyPersonMount />
    </>
  );
}

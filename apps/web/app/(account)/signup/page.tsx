import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { accountDoorEnabled, checksPublicEnabled } from '@/lib/auth/flags';
import { agencySalesOpen, billingPublic } from '@/lib/billing/flags';
import { shownFeatures } from '@/lib/feature-switch';
import { SignupScreen } from '@/components/v2/screens/signup/SignupScreen';

export const metadata: Metadata = { title: 'Create your account' };

/**
 * Sign-up (CC-25). A 404 until V2_ACCOUNT_DOOR=1 (D1); never indexed in this step (D9). The plan
 * table follows the Goal 1 switch (V2_HIDE_FEATURES), and its footer names Agency's trial only while
 * Agency is on sale (V2_BILLING public and V2_AGENCY_SALES), all read here and passed down.
 */
export default function SignupPage() {
  if (!accountDoorEnabled()) notFound();
  return (
    <SignupScreen
      checksPublic={checksPublicEnabled()}
      features={shownFeatures()}
      agencyOpen={billingPublic() && agencySalesOpen()}
    />
  );
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { accountDoorEnabled, pipelineEnabled } from '@/lib/auth/flags';
import { SignupScreen } from '@/components/v2/screens/signup/SignupScreen';

export const metadata: Metadata = { title: 'Create your account' };

/** Sign-up (CC-25). A 404 until V2_ACCOUNT_DOOR=1 (D1); never indexed in this step (D9). */
export default function SignupPage() {
  if (!accountDoorEnabled()) notFound();
  return <SignupScreen pipeline={pipelineEnabled()} />;
}

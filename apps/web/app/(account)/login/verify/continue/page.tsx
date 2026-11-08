import type { Metadata } from 'next';
import { ContinueScreen } from '@/components/v2/screens/continue/ContinueScreen';

export const metadata: Metadata = { title: 'Sign in' };

/**
 * The sign-in landing's page (CC-25 D3). GET /login/verify sends the browser here after moving the
 * link's token into a cookie, so this URL never carries it. Live whatever V2_ACCOUNT_DOOR says.
 */
export default async function ContinuePage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string | string[] }>;
}) {
  const { state } = await searchParams;
  return <ContinueScreen state={state === 'expired' ? 'expired' : 'idle'} />;
}

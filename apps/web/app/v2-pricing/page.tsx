import '../../styles/v2/tokens.css';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { after } from 'next/server';
import { PricingScreen } from '@/components/v2/screens/pricing/PricingScreen';
import { accountDoorEnabled, checksPublicEnabled } from '@/lib/auth/flags';
import { billingV2Enabled } from '@/lib/billing/flags';
import { PRICING_COPY } from '@/lib/v2/copy/pricing';
import { pricingCapture } from '@/lib/v2/pricing/events';
import { readPricingViewer } from '@/lib/v2/pricing/read';
import { reachedByRewrite } from '@/lib/v2/rewrite-target';
import { intervalFrom, pricingView } from '@/lib/v2/view/pricing';

// Rendered per request: the plan buttons read the session.
export const dynamic = 'force-dynamic';

// v1's title and canonical (app/pricing/page.tsx); the description is the v2 plans'.
export const metadata: Metadata = {
  title: 'Pricing',
  description: PRICING_COPY.description(),
  alternates: { canonical: '/pricing' },
};

/**
 * The v2 Pricing page (CC-29 D2), which `/pricing` is rewritten to while V2_BILLING is on
 * (`V2_REWRITES`, lib/v2/rewrites.ts). A 404 with the flag off, and when the request did not come
 * through that rewrite, so the page has one address, `/pricing`. `pricing_viewed` is sent after the
 * response, with the request's cookie header for the visitor's consent.
 */
export default async function V2PricingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!billingV2Enabled()) return notFound();
  if (!(await reachedByRewrite())) return notFound();
  const now = new Date();
  const interval = intervalFrom((await searchParams).interval);
  const viewer = await readPricingViewer(now);
  const capture = pricingCapture((await headers()).get('cookie'));
  const accountId = viewer.kind === 'signed_in' ? (viewer.account?.id ?? null) : null;
  after(() =>
    capture('pricing_viewed', accountId, { interval, signedIn: viewer.kind === 'signed_in' }),
  );
  const flags = { accountDoor: accountDoorEnabled(), checksPublic: checksPublicEnabled() };
  return <PricingScreen view={pricingView(viewer, interval, now, flags)} />;
}

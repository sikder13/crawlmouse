import '../../styles/v2/tokens.css';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { after } from 'next/server';
import { PricingScreen } from '@/components/v2/screens/pricing/PricingScreen';
import { accountDoorEnabled, checksPublicEnabled, v2PublicPagesEnabled } from '@/lib/auth/flags';
import { agencySalesOpen, billingPublic } from '@/lib/billing/flags';
import { CONSENT_REQUIRED_COOKIE, isConsentRequiredCountry } from '@/lib/consent';
import { shownFeatures } from '@/lib/feature-switch';
import { PRICING_COPY } from '@/lib/v2/copy/pricing';
import { pricingCapture } from '@/lib/v2/pricing/events';
import { readPricingVisit } from '@/lib/v2/pricing/read';
import { reachedByRewrite } from '@/lib/v2/rewrite-target';
import { socialCardPath } from '@/lib/v2/social-card';
import { socialMetadata } from '@/lib/v2/social-metadata';
import { intervalFrom, pricingView } from '@/lib/v2/view/pricing';

// Rendered per request: the plan buttons read the session.
export const dynamic = 'force-dynamic';

// v1's title and canonical (app/pricing/page.tsx); the description is the v2 plans', and it is shared
// as itself, with its own card (SEO R2-N6).
export const metadata: Metadata = {
  title: PRICING_COPY.pageTitle,
  description: PRICING_COPY.description(),
  alternates: { canonical: '/pricing' },
  ...socialMetadata({
    path: '/pricing',
    title: PRICING_COPY.pageTitle,
    description: PRICING_COPY.description(),
    image: socialCardPath('pricing'),
  }),
};

/**
 * The cookie header consent is read from. The middleware's region flag is set on the response, so a
 * first visit does not carry it: this adds it from the request's country, and a recorded decision
 * still wins (`serverCaptureAllowed`).
 */
function consentHeader(cookie: string | null, country: string | null): string | null {
  if (!isConsentRequiredCountry(country)) return cookie;
  const flag = `${CONSENT_REQUIRED_COOKIE}=1`;
  return cookie ? `${cookie}; ${flag}` : flag;
}

/**
 * The v2 Pricing page (CC-29 D2), which `/pricing` is rewritten to while V2_CHECKS_PUBLIC or V2_BILLING is on
 * (`V2_REWRITES`, lib/v2/rewrites.ts; RC-01). A 404 with both off, and when the request did not come
 * through that rewrite, so the page has one address, `/pricing`. `pricing_viewed` is sent after the
 * response, with the request's cookie header for the visitor's consent.
 */
export default async function V2PricingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!v2PublicPagesEnabled()) return notFound();
  if (!(await reachedByRewrite())) return notFound();
  const now = new Date();
  const interval = intervalFrom((await searchParams).interval);
  const { viewer, userId } = await readPricingVisit(now);
  const requestHeaders = await headers();
  const capture = pricingCapture(
    consentHeader(requestHeaders.get('cookie'), requestHeaders.get('x-vercel-ip-country')),
  );
  const accountId = viewer.kind === 'signed_in' ? (viewer.account?.id ?? null) : null;
  const person = userId === null ? null : { userId, accountId };
  after(() =>
    capture('pricing_viewed', person, { interval, signedIn: viewer.kind === 'signed_in' }),
  );
  const flags = {
    accountDoor: accountDoorEnabled(),
    checksPublic: checksPublicEnabled(),
    billing: billingPublic(),
    agencySales: agencySalesOpen(),
  };
  // The Goal 1 switch (V2_HIDE_FEATURES), read per request like the rest of this page.
  return <PricingScreen view={pricingView(viewer, interval, now, flags, shownFeatures())} />;
}

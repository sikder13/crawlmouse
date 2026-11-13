import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DevelopersScreen } from '@/components/v2/screens/developers/DevelopersScreen';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { billingV2Enabled } from '@/lib/billing/flags';
import { developersView } from '@/lib/v2/view/developers';
import { socialCardPath } from '@/lib/v2/social-card';
import { socialMetadata } from '@/lib/v2/social-metadata';
import '@/styles/v2/tokens.css';

const view = developersView();

/**
 * The canonical is v1's, `/developers`: the address this page serves. Indexable (the root layout's
 * robots apply). The title changes from v1's "Crawlmouse for developers — CLI, GitHub Action &
 * webhooks" to the artboard's "Developers".
 */
export const metadata: Metadata = {
  title: view.title,
  description: view.description,
  alternates: { canonical: '/developers' },
  ...socialMetadata({
    path: '/developers',
    title: view.title,
    description: view.description,
    image: socialCardPath('developers'),
  }),
};

/**
 * The v2 Developers page (CC-29 D5), which `/developers` is rewritten to while V2_BILLING is on
 * (`V2_REWRITES`, lib/v2/rewrites.ts). The middleware answers a request for this path, in any
 * spelling it can read, as not found; that is the guard on its own address, because the page is
 * prerendered and cannot read the rewrite's header. The flag is read when the site is built: built
 * with it off, the page is a 404. The closing audit form posts to `POST /api/checks`, which answers
 * only while V2_CHECKS_PUBLIC is on; with that flag off it is a link to the home's audit.
 */
export default function V2DevelopersPage() {
  if (!billingV2Enabled()) return notFound();
  return <DevelopersScreen data={view} audit={checksPublicEnabled() ? 'live' : 'home-link'} />;
}

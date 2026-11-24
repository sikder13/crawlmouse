import type { Metadata } from 'next';
import { AgenciesScreen } from '@/components/v2/screens/agencies/AgenciesScreen';
import { accountDoorEnabled, checksPublicEnabled } from '@/lib/auth/flags';
import { agencySalesOpen, billingPublic } from '@/lib/billing/flags';
import { shownFeatures } from '@/lib/feature-switch';
import { socialCardPath } from '@/lib/v2/social-card';
import { socialMetadata } from '@/lib/v2/social-metadata';
import { agenciesView } from '@/lib/v2/view/agencies';
import '@/styles/v2/tokens.css';

// The Goal 1 switch (V2_HIDE_FEATURES) is read here, at build time like the flags: the page and its
// metadata are static, so a change to the switch takes a redeploy.
const view = agenciesView(
  { billing: billingPublic(), agencySales: agencySalesOpen(), accountDoor: accountDoorEnabled() },
  shownFeatures(),
);

/** Indexable (the root layout's robots apply); canonical to its own address, and shared as itself. */
export const metadata: Metadata = {
  title: view.title,
  description: view.description,
  alternates: { canonical: '/agencies' },
  ...socialMetadata({
    path: '/agencies',
    title: view.title,
    description: view.description,
    image: socialCardPath('agencies'),
  }),
};

/**
 * For agencies (CC-29 D4). Served whatever the flags say (RC-01): with V2_BILLING or V2_AGENCY_SALES
 * off (F-251) its first button starts a free account and the trial reads "opens soon". The page is
 * prerendered, so the flags are read when the site is built, and changing one takes a new deployment. The prospect's audit form
 * posts to `POST /api/checks`, which answers only while V2_CHECKS_PUBLIC is on; with that flag off
 * the form is a link to the home's audit instead.
 */
export default function AgenciesPage() {
  return <AgenciesScreen data={view} audit={checksPublicEnabled() ? 'live' : 'home-link'} />;
}

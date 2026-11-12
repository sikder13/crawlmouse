import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AgenciesScreen } from '@/components/v2/screens/agencies/AgenciesScreen';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { billingV2Enabled } from '@/lib/billing/flags';
import { socialMetadata } from '@/lib/v2/social-metadata';
import { agenciesView } from '@/lib/v2/view/agencies';
import '@/styles/v2/tokens.css';

const view = agenciesView();

/** Indexable (the root layout's robots apply); canonical to its own address, and shared as itself. */
export const metadata: Metadata = {
  title: view.title,
  description: view.description,
  alternates: { canonical: '/agencies' },
  ...socialMetadata({ path: '/agencies', title: view.title, description: view.description }),
};

/**
 * For agencies (CC-29 D4), a new address: a 404 unless V2_BILLING is on, the flag its trial button
 * leads to the Agency trial under. The page is prerendered, so the flag is read when the site is
 * built, as `/v2-home` reads its own: built with the flag off it is a 404, and turning the flag on
 * takes a new deployment. The prospect's audit form posts to `POST /api/checks`, which answers only
 * while V2_CHECKS_PUBLIC is on; with that flag off the form is a link to the home's audit instead.
 */
export default function AgenciesPage() {
  if (!billingV2Enabled()) return notFound();
  return <AgenciesScreen data={view} audit={checksPublicEnabled() ? 'live' : 'home-link'} />;
}

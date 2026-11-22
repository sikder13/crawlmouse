import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DevelopersScreen } from '@/components/v2/screens/developers/DevelopersScreen';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { DEVELOPERS_COPY } from '@/lib/v2/copy/developers';
import { developersView } from '@/lib/v2/view/developers';
import { socialCardPath } from '@/lib/v2/social-card';
import { socialMetadata } from '@/lib/v2/social-metadata';
import '@/styles/v2/tokens.css';

const view = developersView();

/**
 * The title, description and canonical are v1's (B question 002): the address this page serves.
 * Indexable (the root layout's robots apply).
 */
export const metadata: Metadata = {
  title: view.title,
  description: DEVELOPERS_COPY.indexedDescription,
  alternates: { canonical: '/developers' },
  ...socialMetadata({
    path: '/developers',
    title: view.title,
    description: DEVELOPERS_COPY.indexedDescription,
    image: socialCardPath('developers'),
  }),
};

/**
 * The v2 Developers page (CC-29 D5), which `/developers` is rewritten to while V2_CHECKS_PUBLIC is on
 * (`V2_REWRITES`, lib/v2/rewrites.ts). The middleware answers a request for this path, in any
 * spelling it can read, as not found; that is the guard on its own address, because the page is
 * prerendered and cannot read the rewrite's header. The flag is read when the site is built: built
 * with it off, the page is a 404.
 */
export default function V2DevelopersPage() {
  if (!checksPublicEnabled()) return notFound();
  return <DevelopersScreen data={view} audit="live" />;
}

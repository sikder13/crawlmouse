import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HelpIndexScreen } from '@/components/v2/screens/help/HelpScreens';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { HELP_COPY } from '@/lib/v2/help/copy';
import { HELP_INDEX_PATH, helpIndexView } from '@/lib/v2/help/view';
import { socialCardPath } from '@/lib/v2/social-card';
import { socialMetadata } from '@/lib/v2/social-metadata';
import '@/styles/v2/tokens.css';

/** Indexable (the root layout's robots apply); canonical to its own address, and shared as itself. */
export const metadata: Metadata = {
  title: HELP_COPY.title,
  description: HELP_COPY.description,
  alternates: { canonical: HELP_INDEX_PATH },
  ...socialMetadata({
    path: HELP_INDEX_PATH,
    title: HELP_COPY.title,
    description: HELP_COPY.description,
    image: socialCardPath('help'),
  }),
};

/**
 * The help centre's index (CC-33 D4): a 404 unless V2_CHECKS_PUBLIC is on, the flag the product the
 * articles describe is served under. The page is prerendered, so the flag is read when the site is
 * built, as the /check pages read it: turning it on takes a new deployment.
 */
export default function HelpPage() {
  if (!checksPublicEnabled()) return notFound();
  return <HelpIndexScreen data={helpIndexView()} />;
}

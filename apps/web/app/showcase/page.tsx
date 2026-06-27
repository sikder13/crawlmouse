import type { Metadata } from 'next';
import { Showcase } from '@/components/dev/Showcase';

// TEMPORARY look-review surface for SPEC 03 Phase A (design-system elevation). noindex;
// removed before the PR merges — do not ship to prod.
export const metadata: Metadata = {
  title: 'Design system (preview)',
  robots: { index: false, follow: false },
};

export default function ShowcasePage() {
  return <Showcase />;
}

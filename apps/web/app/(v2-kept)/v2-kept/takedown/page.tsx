import { notFound } from 'next/navigation';
import TakedownPage from '@/app/takedown/page';
import { keptPage } from '@/app/(v2-kept)/_lib/KeptShell';
import { checksPublicEnabled } from '@/lib/auth/flags';

export { metadata } from '@/app/takedown/page';

/** `/takedown` in the v2 shell while V2_CHECKS_PUBLIC is on (CC-36 D3, `V2_REWRITES`); a 404 with it off. */
export default function KeptTakedownPage() {
  if (!checksPublicEnabled()) return notFound();
  return keptPage(TakedownPage());
}

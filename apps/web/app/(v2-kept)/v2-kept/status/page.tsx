import { notFound } from 'next/navigation';
import StatusPage from '@/app/status/page';
import { keptPage } from '@/app/(v2-kept)/_lib/KeptShell';
import { checksPublicEnabled } from '@/lib/auth/flags';

export { metadata } from '@/app/status/page';

// v1's page is rendered per request, so the state it reports is the serving deployment's (CC-33);
// a route-segment export is a literal of its own here, not a re-export (OPERATING-RULES §7).
export const dynamic = 'force-dynamic';

/** `/status` in the v2 shell while V2_CHECKS_PUBLIC is on (CC-36 D3, `V2_REWRITES`); a 404 with it off. */
export default function KeptStatusPage() {
  if (!checksPublicEnabled()) return notFound();
  return keptPage(StatusPage());
}

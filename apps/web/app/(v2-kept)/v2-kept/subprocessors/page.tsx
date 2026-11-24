import { notFound } from 'next/navigation';
import SubprocessorsPage from '@/app/subprocessors/page';
import { legalPage } from '@/app/(v2-kept)/_lib/LegalShell';
import { checksPublicEnabled } from '@/lib/auth/flags';

export { metadata } from '@/app/subprocessors/page';

/** `/subprocessors` in the v2 shell while V2_CHECKS_PUBLIC is on (CC-36 D3, `V2_REWRITES`); a 404 with it off. */
export default function KeptSubprocessorsPage() {
  if (!checksPublicEnabled()) return notFound();
  return legalPage(SubprocessorsPage());
}

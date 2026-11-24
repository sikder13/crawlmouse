import { notFound } from 'next/navigation';
import TermsPage from '@/app/terms/page';
import { legalPage } from '@/app/(v2-kept)/_lib/LegalShell';
import { checksPublicEnabled } from '@/lib/auth/flags';

export { metadata } from '@/app/terms/page';

/** `/terms` in the v2 shell while V2_CHECKS_PUBLIC is on (CC-36 D3, `V2_REWRITES`); a 404 with it off. */
export default function KeptTermsPage() {
  if (!checksPublicEnabled()) return notFound();
  return legalPage(TermsPage());
}

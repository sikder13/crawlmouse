import { notFound } from 'next/navigation';
import PrivacyPage from '@/app/privacy/page';
import { legalPage } from '@/app/(v2-kept)/_lib/LegalShell';
import { checksPublicEnabled } from '@/lib/auth/flags';

export { metadata } from '@/app/privacy/page';

/** `/privacy` in the v2 shell while V2_CHECKS_PUBLIC is on (CC-36 D3, `V2_REWRITES`); a 404 with it off. */
export default function KeptPrivacyPage() {
  if (!checksPublicEnabled()) return notFound();
  return legalPage(PrivacyPage());
}

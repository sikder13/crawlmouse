import { notFound } from 'next/navigation';
import { KeptAiReadinessChecker } from '@/app/(v2-kept)/_lib/KeptAiReadinessChecker';
import { checksPublicEnabled } from '@/lib/auth/flags';

export { metadata } from '@/app/ai-readiness-checker/AiReadinessChecker';

/**
 * `/ai-readiness-checker` in the v2 shell while V2_CHECKS_PUBLIC is on (CC-36 D3, `V2_REWRITES`);
 * a 404 with it off.
 */
export default function KeptAiReadinessCheckerPage() {
  if (!checksPublicEnabled()) return notFound();
  return <KeptAiReadinessChecker />;
}

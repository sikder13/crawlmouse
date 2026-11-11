import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { CrawlmouseMark } from '@/components/icons/CrawlmouseMark';
import { checksPublicEnabled } from '@/lib/auth/flags';
import RootNotFound from '../../../not-found';

/**
 * The 404 of a v2 check's overview. With V2_CHECKS_PUBLIC on it says what an id that reads nothing
 * can mean: an anonymous audit is deleted after it expires, and nothing then tells its id from one
 * that never existed (CC-22b Q13). `/audit/[id]` sends an id that is neither a v2 check nor a v1
 * audit here under the flag. With the flag off it is the site's own 404.
 *
 * It sits under `overview/`, not beside the v1 page: a not-found file at `/audit/[id]` would change
 * what the v1 page's own 404 sends with the flag off.
 */
export default function AuditNotFound() {
  if (!checksPublicEnabled()) return <RootNotFound />;
  return (
    <main className="min-h-screen bg-cream flex flex-col items-center justify-center p-8 text-center">
      <CrawlmouseMark size={128} className="mb-6" />
      <h1 className="font-display font-bold text-6xl tracking-tight">404</h1>
      <p className="font-display text-2xl text-ink/70 mt-3 italic">
        This audit does not exist, or it has expired.
      </p>
      <p className="mt-3 max-w-md text-ink/70">
        An audit nobody keeps is visible for 24 hours and is then deleted. Running it again is free.
      </p>
      <Button asChild size="lg" className="mt-8">
        <Link href={{ pathname: '/' }}>Start a new audit</Link>
      </Button>
    </main>
  );
}

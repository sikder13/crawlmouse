import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { CrawlmouseMark } from '@/components/icons/CrawlmouseMark';
import { checksPublicEnabled } from '@/lib/auth/flags';
import RootNotFound from '../../../not-found';

/**
 * The 404 of a v2 check, for an id the viewer may not read and for one that names nothing. The two
 * must read alike, or the page says whether a private result exists, so this component takes no id
 * and reads no check (F-127). With V2_CHECKS_PUBLIC off it is the site’s own 404.
 *
 * It sits under `overview/`, not beside the v1 page: a not-found file at `/audit/[id]` would change
 * what the v1 page's own 404 sends with the flag off. The tabs re-export it.
 */
export default function AuditNotFound() {
  if (!checksPublicEnabled()) return <RootNotFound />;
  return (
    <main className="min-h-screen bg-cream flex flex-col items-center justify-center p-8 text-center">
      <CrawlmouseMark size={128} className="mb-6" />
      <h1 className="font-display font-bold text-4xl tracking-tight">We can’t show this page</h1>
      <p className="font-display text-2xl text-ink/70 mt-3 italic">
        It may belong to an account, or it may have expired.
      </p>
      <p className="mt-3 max-w-md text-ink/70">
        An audit nobody keeps is visible for 24 hours and is then deleted. If it is yours, sign in
        with the account that keeps it.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button asChild size="lg">
          <Link href={{ pathname: '/login' }}>Sign in</Link>
        </Button>
        <Button asChild size="lg" variant="secondary">
          <Link href={{ pathname: '/' }}>Start a new audit</Link>
        </Button>
      </div>
    </main>
  );
}

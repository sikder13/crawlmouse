import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { CrawlmouseMark } from '@/components/icons/CrawlmouseMark';
import { NotFoundScreen } from '@/components/v2/screens/not-found/NotFoundScreen';
import { checksPublicEnabled } from '@/lib/auth/flags';
import '@/styles/v2/tokens.css';

/** A 404 is no page of the site: it takes neither the home's title nor its canonical. */
export const metadata: Metadata = { title: 'Page not found', alternates: { canonical: null } };

/** The v2 404 while V2_CHECKS_PUBLIC serves the v2 site (RC-20); v1's with the flag off. */
export default function NotFound() {
  if (checksPublicEnabled()) return <NotFoundScreen />;
  return (
    <main className="min-h-screen bg-cream flex flex-col items-center justify-center p-8 text-center">
      <CrawlmouseMark size={128} className="mb-6" />
      <h1 className="font-display font-bold text-6xl tracking-tight">404</h1>
      <p className="font-display text-2xl text-ink/70 mt-3 italic">
        Sniffed around. This page isn&rsquo;t here.
      </p>
      <Button asChild size="lg" className="mt-8">
        <Link href={{ pathname: '/' }}>Go home</Link>
      </Button>
    </main>
  );
}

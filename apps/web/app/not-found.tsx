import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { CrawlmouseMark } from '@/components/icons/CrawlmouseMark';

export default function NotFound() {
  return (
    <main className="min-h-screen bg-cream flex flex-col items-center justify-center p-8 text-center">
      <CrawlmouseMark size={128} className="mb-6" />
      <h1 className="font-display font-bold text-6xl tracking-tight">404</h1>
      <p className="font-display text-2xl text-ink/70 mt-3 italic">Sniffed around. This page isn&rsquo;t here.</p>
      <Link href={{ pathname: '/' }} className="mt-8">
        <Button size="lg">Go home</Button>
      </Link>
    </main>
  );
}

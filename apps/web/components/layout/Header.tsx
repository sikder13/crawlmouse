import Link from 'next/link';
import type { UrlObject } from 'url';
import { CrawlmouseMark } from '@/components/icons/CrawlmouseMark';
import { AuthNav } from './AuthNav';

const r = (p: string): UrlObject => ({ pathname: p });

export function Header() {
  return (
    <header className="border-b border-oat bg-cream/90 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <CrawlmouseMark size={32} />
          <span className="font-display font-semibold text-2xl tracking-tight">
            crawl<span className="text-peach">mouse</span>
          </span>
        </Link>
        <nav className="flex items-center gap-7 text-sm font-medium">
          <Link href={r('/pricing')} className="hover:text-peach transition-colors">Pricing</Link>
          <Link href={r('/dashboard')} className="hover:text-peach transition-colors">Dashboard</Link>
          <AuthNav />
        </nav>
      </div>
    </header>
  );
}

import Link from 'next/link';
import { CrawlmouseMark } from '@/components/icons/CrawlmouseMark';
import { HeaderNav } from './HeaderNav';

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-oat bg-cream/90 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <CrawlmouseMark size={32} />
          <span className="font-display font-semibold text-xl sm:text-2xl tracking-tight">
            crawl<span className="text-peach">mouse</span>
          </span>
        </Link>
        <HeaderNav />
      </div>
    </header>
  );
}

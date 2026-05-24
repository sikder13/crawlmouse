import Link from 'next/link';
import type { UrlObject } from 'url';

const r = (p: string): UrlObject => ({ pathname: p });

export function Footer() {
  return (
    <footer className="border-t border-oat mt-24 bg-cream">
      <div className="max-w-6xl mx-auto px-6 py-10 grid grid-cols-2 md:grid-cols-4 gap-6 text-sm">
        <div>
          <div className="font-display font-bold text-lg mb-2">crawlmouse</div>
          <div className="text-ink/60">Internal-linking grading for any site.</div>
        </div>
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-ink/50 font-semibold">Product</div>
          <Link href={r('/pricing')} className="block hover:text-peach">Pricing</Link>
          <Link href={r('/bot')} className="block hover:text-peach">Crawlmouse Bot</Link>
        </div>
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-ink/50 font-semibold">For developers</div>
          <span className="block text-ink/60">CLI + GitHub Action</span>
          <span className="block text-ink/40 text-xs">Coming Q3 2026</span>
        </div>
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-ink/50 font-semibold">Legal</div>
          <Link href={r('/privacy')} className="block hover:text-peach">Privacy</Link>
          <Link href={r('/terms')} className="block hover:text-peach">Terms</Link>
          <Link href={r('/aup')} className="block hover:text-peach">Acceptable use</Link>
        </div>
      </div>
    </footer>
  );
}

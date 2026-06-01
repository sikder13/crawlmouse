import Link from 'next/link';
import { Button } from '@/components/ui/Button';

/** Reusable inline paywall card (honest cutoff). Used after top-5 findings, CSV, page-cap, badge. */
export function UpgradeCard({ headline, sub }: { headline: string; sub?: string }) {
  return (
    <div className="rounded-2xl border-[1.5px] border-dashed border-peach bg-peach/5 p-5 text-center">
      <p className="font-display font-semibold text-ink">🐭 {headline}</p>
      {sub && <p className="text-sm text-ink/70 mt-1">{sub}</p>}
      <Link href="/pricing" className="inline-block mt-3">
        <Button variant="primary" size="sm">Unlock Pro · $19 →</Button>
      </Link>
    </div>
  );
}

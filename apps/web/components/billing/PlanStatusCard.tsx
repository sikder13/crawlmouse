import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { buttonClasses } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { LocalTime } from '@/components/ui/LocalTime';
import { planCardModel } from '@/lib/billing/plan-card';

/**
 * Dashboard plan-status card. Pro → sage-accented "Manage subscription" → /billing
 * (a Route Handler, so a plain <a>, not a typed <Link>); free → peach-nudge "Upgrade" → /pricing.
 */
export function PlanStatusCard({ proUntil }: { proUntil: string | null | undefined }) {
  const m = planCardModel({ proUntil });

  if (m.variant === 'pro') {
    return (
      <Card className="border-l-4 border-l-sage flex flex-wrap items-center justify-between gap-4">
        <div>
          <Badge tone="sage">{m.statusLabel}</Badge>
          <div className="font-display font-bold text-2xl mt-2">Crawlmouse Pro 🐭</div>
          {m.proUntilIso && (
            <div className="text-sm text-ink/60 mt-1">
              Active until <LocalTime iso={m.proUntilIso} />
            </div>
          )}
        </div>
        {/* /billing is a Route Handler (GET → Stripe portal), not a typed page route → plain anchor. */}
        <a href="/billing" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
          {m.ctaLabel} →
        </a>
      </Card>
    );
  }

  return (
    <Card className="border-l-4 border-l-peach flex flex-wrap items-center justify-between gap-4">
      <div>
        <Badge tone="oat">{m.statusLabel}</Badge>
        <div className="font-display font-bold text-2xl mt-2">You&apos;re on the free plan</div>
        <div className="text-sm text-ink/60 mt-1">Unlock 2,000-page crawls, the full findings list &amp; CSV export.</div>
      </div>
      <Link href={{ pathname: '/pricing' }} className={buttonClasses({ size: 'sm' })}>
        {m.ctaLabel} →
      </Link>
    </Card>
  );
}

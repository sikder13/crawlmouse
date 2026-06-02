'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';

const MAX_TRIES = 10; // ~15s — webhooks normally land in <2s; cap so we don't poll forever.
const INTERVAL_MS = 1500;

/**
 * Shown on /dashboard?upgraded=1 when the just-paid user isn't Pro yet (the entitlement webhook
 * can land a beat after Stripe's redirect). Polls the lightweight /api/billing/status bit; once
 * Pro, it strips ?upgraded=1 and re-renders so the dashboard swaps in the Pro PlanStatusCard.
 */
export function ActivatingPro() {
  const router = useRouter();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    let tries = 0;
    let stopped = false;
    const timer = setInterval(async () => {
      tries += 1;
      try {
        const res = await fetch('/api/billing/status', { cache: 'no-store' });
        const { pro } = (await res.json()) as { pro?: boolean };
        if (pro && !stopped) {
          stopped = true;
          clearInterval(timer);
          router.replace('/dashboard'); // drop ?upgraded=1 + re-render → Pro card
          router.refresh();
          return;
        }
      } catch { /* transient — keep polling */ }
      if (tries >= MAX_TRIES && !stopped) {
        stopped = true;
        clearInterval(timer);
        setSlow(true);
      }
    }, INTERVAL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [router]);

  return (
    <Card className="border-l-4 border-l-sage flex flex-wrap items-center justify-between gap-4">
      <div aria-live="polite">
        <div className="font-display font-bold text-2xl">Activating your Pro plan 🐭</div>
        <div className="text-sm text-ink/60 mt-1">
          {slow ? 'Taking a little longer than usual — refresh in a moment.' : 'Confirming your payment with Stripe… just a few seconds.'}
        </div>
      </div>
      <div role="status" aria-label="Activating" className="h-5 w-5 shrink-0 rounded-full border-2 border-sage border-t-transparent animate-spin" />
    </Card>
  );
}

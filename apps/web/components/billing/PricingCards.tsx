'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

// Value-first ordering (D4 — gate VALUE, not VOLUME): the outcome (the grade, the gap, the fix)
// leads; page/rate caps are demoted to a single line each.
const FREE_FEATURES = [
  'Audit any site — letter grade + live link graph',
  'Your biggest gap: current grade vs. achievable',
  'One complete fix, free — start to finish',
  'See every issue we found (full fixes locked)',
  'Crawl up to 500 pages · 1 audit per domain, per hour',
  'Peer benchmarks + a shareable report & badge',
];
const PRO_FEATURES = [
  'Everything in Free, plus:',
  'Every fix, end to end — the exact links to add on each page',
  'Copy-paste AI action packets for each fix',
  'Re-audit anytime + watch your grade climb over time',
  'Full finding lists + CSV export',
  'Crawl up to 2,000 pages · no per-domain rate limit',
  'Private (non-indexed) reports + remove the badge',
];

export function PricingCards({ monthlyPriceId, yearlyPriceId }: { monthlyPriceId: string; yearlyPriceId: string }) {
  const [annual, setAnnual] = useState(true); // annual default
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upgrade() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId: annual ? yearlyPriceId : monthlyPriceId }),
      });
      if (res.status === 401) { window.location.href = '/login'; return; }
      if (!res.ok) { setError('Could not start checkout. Please try again.'); return; }
      const { url } = await res.json();
      if (url) { window.location.href = url; return; }
      setError('Could not start checkout. Please try again.');
    } catch {
      setError('Network error — please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="flex justify-center mb-8">
        <div className="inline-flex items-center gap-1 rounded-full border border-oat p-1 bg-white">
          <button onClick={() => setAnnual(false)} className={`px-4 py-1.5 rounded-full text-sm font-medium ${!annual ? 'bg-ink text-cream' : 'text-ink/70'}`}>Monthly</button>
          <button onClick={() => setAnnual(true)} className={`px-4 py-1.5 rounded-full text-sm font-medium ${annual ? 'bg-ink text-cream' : 'text-ink/70'}`}>
            Annual <span className="text-sage font-semibold">· 2 months free</span>
          </button>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <div className="mb-5">
            <div className="font-display font-bold text-2xl">Free</div>
            <div className="mt-1 flex items-baseline gap-2"><span className="font-display font-bold text-5xl">$0</span><span className="text-ink/60">forever</span></div>
          </div>
          <ul className="space-y-2 mb-6">{FREE_FEATURES.map((f) => <li key={f} className="flex gap-2 text-sm"><span className="text-sage font-bold">&#10003;</span><span>{f}</span></li>)}</ul>
          <a href="/" className={buttonClasses({ variant: 'secondary', className: 'w-full' })}>Start free</a>
        </Card>
        <Card className="border-peach !border-2 relative">
          <div className="absolute -top-3 left-6"><Badge tone="peach">Most popular</Badge></div>
          <div className="mb-5">
            <div className="font-display font-bold text-2xl">Pro</div>
            {/* Display only — the actual charge comes from STRIPE_PRICE_ID_PRO_{MONTHLY,YEARLY}.
                Keep these labels in sync with the Stripe prices ($19/mo, $190/yr = 2 months free). */}
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-display font-bold text-5xl">{annual ? '$190' : '$19'}</span>
              <span className="text-ink/60">{annual ? 'per year' : 'per month'}</span>
            </div>
          </div>
          <ul className="space-y-2 mb-6">{PRO_FEATURES.map((f) => <li key={f} className="flex gap-2 text-sm"><span className="text-sage font-bold">&#10003;</span><span>{f}</span></li>)}</ul>
          <Button variant="primary" className="w-full" onClick={upgrade} disabled={loading}>
            {loading ? 'Starting checkout…' : annual ? 'Upgrade — Pro $190/yr' : 'Upgrade — Pro $19/mo'}
          </Button>
          {error && <p className="text-warning text-sm text-center mt-3">{error}</p>}
        </Card>
      </div>
    </>
  );
}

'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

const FREE_FEATURES = [
  '1 audit per domain per 24h',
  'Crawl up to 500 pages',
  'Letter grade + live graph',
  'Counts + top-5 examples of each finding',
  'Peer benchmarks',
  '"Powered by Crawlmouse" embed badge',
];
const PRO_FEATURES = [
  'Everything in Free, plus:',
  'Crawl up to 2,000 pages',
  'Full finding lists + CSV export',
  'No domain rate limit',
  'Private (non-indexed) reports',
  'Remove or customize the embed badge',
];

export function PricingCards({ monthlyPriceId, yearlyPriceId }: { monthlyPriceId: string; yearlyPriceId: string }) {
  const [annual, setAnnual] = useState(true); // annual default
  const [loading, setLoading] = useState(false);

  async function upgrade() {
    setLoading(true);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId: annual ? yearlyPriceId : monthlyPriceId }),
      });
      if (res.status === 401) { window.location.href = '/login'; return; }
      const { url } = await res.json();
      if (url) window.location.href = url;
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
          <a href="/"><Button variant="secondary" className="w-full">Start free</Button></a>
        </Card>
        <Card className="border-peach !border-2 relative">
          <div className="absolute -top-3 left-6"><Badge tone="peach">Most popular</Badge></div>
          <div className="mb-5">
            <div className="font-display font-bold text-2xl">Pro</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-display font-bold text-5xl">{annual ? '$190' : '$19'}</span>
              <span className="text-ink/60">{annual ? 'per year' : 'per month'}</span>
            </div>
          </div>
          <ul className="space-y-2 mb-6">{PRO_FEATURES.map((f) => <li key={f} className="flex gap-2 text-sm"><span className="text-sage font-bold">&#10003;</span><span>{f}</span></li>)}</ul>
          <Button variant="primary" className="w-full" onClick={upgrade} disabled={loading}>
            {loading ? 'Starting checkout…' : annual ? 'Upgrade — Pro $190/yr' : 'Upgrade — Pro $19/mo'}
          </Button>
        </Card>
      </div>
    </>
  );
}

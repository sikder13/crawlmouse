import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import Link from 'next/link';

const TIERS = [
  {
    name: 'Free',
    price: '$0',
    cadence: 'forever',
    features: [
      '1 audit per domain per 24h',
      'Crawl up to 500 pages',
      'Letter grade + live graph',
      'Counts + top-5 examples of each finding',
      'Peer benchmarks',
      '"Powered by Crawlmouse" embed badge',
    ],
    cta: 'Start free',
    href: '/',
    primary: false,
  },
  {
    name: 'Pro',
    price: '$19',
    cadence: 'per month',
    features: [
      'Everything in Free, plus:',
      'Crawl up to 2,000 pages',
      'CSV / Excel export of every finding',
      'No domain rate limit',
      'Private (non-indexed) reports',
      'Remove or customize the embed badge',
    ],
    cta: 'Upgrade — Pro $19',
    href: '/dashboard',
    primary: true,
  },
];

export default function PricingPage() {
  return (
    <>
      <Header />
      <main className="max-w-5xl mx-auto px-6 pt-20 pb-32">
        <section className="text-center mb-16 max-w-2xl mx-auto">
          <h1 className="font-display font-bold text-5xl tracking-tight">Pricing</h1>
          <p className="mt-4 text-lg text-ink/70">
            Free is genuinely free. Pay only when you need exports, more pages, or the badge gone.
          </p>
        </section>
        <section className="grid md:grid-cols-2 gap-6">
          {TIERS.map((t) => (
            <Card key={t.name} className={t.primary ? 'border-peach !border-2 relative' : ''}>
              {t.primary && (
                <div className="absolute -top-3 left-6">
                  <Badge tone="peach">Most popular</Badge>
                </div>
              )}
              <div className="mb-5">
                <div className="font-display font-bold text-2xl">{t.name}</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-display font-bold text-5xl">{t.price}</span>
                  <span className="text-ink/60">{t.cadence}</span>
                </div>
              </div>
              <ul className="space-y-2 mb-6">
                {t.features.map((f) => (
                  <li key={f} className="flex gap-2 text-sm">
                    <span className="text-sage font-bold">&#10003;</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link href={{ pathname: t.href }}>
                <Button variant={t.primary ? 'primary' : 'secondary'} className="w-full">{t.cta}</Button>
              </Link>
            </Card>
          ))}
        </section>
      </main>
      <Footer />
    </>
  );
}

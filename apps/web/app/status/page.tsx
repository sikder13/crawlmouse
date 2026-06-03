import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Card } from '@/components/ui/Card';

export const metadata = {
  title: 'Status — Crawlmouse',
};

// Static status page — no external calls, safe to render at build time. Real-time monitoring moves
// to status.crawlmouse.com at deploy.
const COMPONENTS: { name: string; blurb: string }[] = [
  { name: 'Web app', blurb: 'crawlmouse.com and the dashboard' },
  { name: 'Crawler', blurb: 'CrawlmouseBot and the audit engine' },
  { name: 'Billing', blurb: 'Pro checkout and the billing portal' },
  { name: 'Email', blurb: 'Magic-link sign-in delivery' },
];

// Single green status pill, reused for every component row. (The hero no longer hand-duplicates
// this markup — the h1 already announces the overall "All systems nominal" state.)
function StatusPill({ label = 'Operational' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-sage/15 px-3 py-1 text-sm font-semibold text-sage">
      <span className="h-2 w-2 rounded-full bg-sage" aria-hidden="true" />
      {label}
    </span>
  );
}

export default function StatusPage() {
  return (
    <>
      <Header />
      <main className="max-w-3xl mx-auto px-6 pt-20 pb-32">
        <h1 className="font-display font-bold text-5xl tracking-tight">
          All systems nominal <span aria-hidden="true">🐭</span>
        </h1>
        <p className="mt-4 text-lg text-ink/70">
          The mouse is well-fed and the wheels are turning. Here&rsquo;s where each piece of Crawlmouse
          stands right now.
        </p>

        <Card className="mt-10 p-0 overflow-hidden">
          <ul>
            {COMPONENTS.map((c, i) => (
              <li
                key={c.name}
                className={`flex items-center justify-between gap-4 px-6 py-5 ${i > 0 ? 'border-t border-oat' : ''}`}
              >
                <div>
                  <div className="font-display font-bold text-lg text-ink">{c.name}</div>
                  <div className="text-sm text-ink/60">{c.blurb}</div>
                </div>
                <StatusPill />
              </li>
            ))}
          </ul>
        </Card>

        <Card className="mt-6 bg-peach/10 border-peach/40">
          <p className="text-ink/80 leading-relaxed">
            <strong className="font-semibold">Heads up:</strong> this is a static snapshot. Live,
            minute-by-minute status with incident history is moving to{' '}
            <span className="font-mono text-sm bg-oat px-1.5 py-0.5 rounded">status.crawlmouse.com</span>{' '}
            at deploy.
          </p>
        </Card>

        <p className="mt-6 text-sm text-ink/60">
          Seeing something we&rsquo;re not? Email{' '}
          <a className="text-peach underline" href="mailto:support@crawlmouse.com">support@crawlmouse.com</a>.
        </p>
      </main>
      <Footer />
    </>
  );
}

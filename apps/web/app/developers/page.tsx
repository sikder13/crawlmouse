import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Card } from '@/components/ui/Card';
import { WaitlistForm } from '@/components/developers/WaitlistForm';

export const metadata = {
  title: 'Crawlmouse for developers — CLI, GitHub Action & webhooks',
};

const TEASERS = [
  {
    emoji: '⌨️',
    title: 'crawlmouse CLI',
    body: 'Grade your internal linking from the terminal. Pipe the JSON anywhere, fail your build on a regression.',
  },
  {
    emoji: '🤖',
    title: 'GitHub Action',
    body: 'Drop it into CI and get a structural-linking score on every PR — comment, badge, the works.',
  },
  {
    emoji: '🪝',
    title: 'Agentic webhooks',
    body: 'Same engine, event-driven. Wire audits into your agents and let them act on the findings.',
  },
];

export default function DevelopersPage() {
  return (
    <>
      <Header />
      <main className="max-w-3xl mx-auto px-6 pt-20 pb-32">
        <span className="inline-block rounded-full border border-peach/40 bg-peach/10 px-3 py-1 text-xs font-mono uppercase tracking-wider text-peach">
          Coming Q3 2026
        </span>
        <h1 className="mt-5 font-display font-bold text-5xl tracking-tight">Crawlmouse for developers</h1>
        <p className="mt-4 text-lg text-ink/70">
          CLI + GitHub Action + agentic webhooks on the same engine that powers the web app.
          <span className="text-ink"> Coming Q3 2026.</span>
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {TEASERS.map((t) => (
            <Card key={t.title} className="flex flex-col">
              <div className="text-3xl" aria-hidden>{t.emoji}</div>
              <h2 className="mt-3 font-display font-bold text-lg">{t.title}</h2>
              <p className="mt-1.5 text-sm text-ink/70 leading-relaxed">{t.body}</p>
            </Card>
          ))}
        </div>

        <Card className="mt-10">
          <h2 className="font-display font-bold text-2xl">Want first dibs? 🐭</h2>
          <p className="mt-2 text-ink/70 leading-relaxed">
            Leave your email and we&rsquo;ll ping you the moment the dev tools land &mdash; plus a heads-up before
            anyone else. No spam, no drip campaign, just the launch.
          </p>
          <div className="mt-6 max-w-sm">
            <WaitlistForm />
          </div>
        </Card>
      </main>
      <Footer />
    </>
  );
}

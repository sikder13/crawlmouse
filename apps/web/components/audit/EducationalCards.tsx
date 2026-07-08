'use client';

import { useEffect, useState } from 'react';

// SPEC 04 §2.7 — rotating educational micro-cards for the wait. HONESTY NOTE: this is the ONE
// timer-driven element of the wait experience, and that is deliberate + honest because it is
// explicitly labeled education ("While you wait"), never activity or progress — the activity feed
// and progress bar advance exclusively on real pipeline events. Static copy; doubles as onboarding.

const CARDS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'What’s an orphan page?',
    body: 'A page with no internal links pointing to it. Visitors and crawlers can only find it by knowing the URL — for search engines it may as well not exist.',
  },
  {
    title: 'Why click depth matters',
    body: 'Every click from the homepage is a step crawlers may not take. Pages buried 4+ clicks deep get crawled less and carry less authority.',
  },
  {
    title: 'Anchor text is a signal',
    body: '“Click here” tells search engines nothing. Descriptive anchors — “pricing for agencies” — tell them exactly what the target page is about.',
  },
  {
    title: 'Hubs concentrate authority',
    body: 'Strong sites route internal links through a few well-connected hub pages. A flat spray of links spreads authority thin.',
  },
  {
    title: 'AI crawlers read static HTML',
    body: 'Most AI crawlers don’t run JavaScript. What this crawl sees is very close to what they see — links rendered only by JS are invisible to both.',
  },
];

const ROTATE_MS = 8000;

export function EducationalCards() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setIndex((i) => (i + 1) % CARDS.length), ROTATE_MS);
    return () => clearInterval(t);
  }, []);

  const card = CARDS[index] ?? CARDS[0]!;
  return (
    <div className="bg-cream border border-oat rounded-2xl p-5">
      <div className="text-xs uppercase tracking-wide text-ink/50 mb-2">While you wait — internal linking 101</div>
      <p className="font-display font-semibold">{card.title}</p>
      <p className="mt-1 text-sm text-ink/70">{card.body}</p>
      <div className="flex gap-1.5 mt-3" aria-hidden>
        {CARDS.map((_, i) => (
          <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === index ? 'bg-peach' : 'bg-oat'}`} />
        ))}
      </div>
    </div>
  );
}

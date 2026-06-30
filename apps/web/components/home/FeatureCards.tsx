import type { ReactNode } from 'react';
import { Card } from '../ui/Card';
import { Explainer } from '../ui/Explainer';

// Homepage feature cards (SPEC 03 Part 3): each is educational — a short plain blurb + an expandable
// "what/why" (Part 2) so a first-timer who's never heard of internal linking understands what they'll
// get and why it matters before running an audit. Subtle entrance + hover motion (reduced-motion safe).
interface Feature {
  title: string;
  blurb: string;
  explainSummary: string;
  explain: ReactNode;
}

const FEATURES: Feature[] = [
  {
    title: 'Live link graph',
    blurb: 'Watch your site take shape as the crawler runs — the live map of how your pages link to each other.',
    explainSummary: 'What is internal linking?',
    explain: (
      <p>
        Internal links are the links from one page on your site to another. Together they form a graph
        that search engines and AI crawlers follow to discover and rank your pages — a well-connected
        graph means more of your pages get found.
      </p>
    ),
  },
  {
    title: 'A–F letter grade',
    blurb: 'One score from four parts: orphan pages, click depth, anchor-text quality, and structure.',
    explainSummary: 'How is the grade calculated?',
    explain: (
      <ul className="list-disc space-y-1 pl-4">
        <li>
          <strong>Orphans (40%)</strong> — pages nothing links to.
        </li>
        <li>
          <strong>Click depth (20%)</strong> — how far pages sit from the homepage.
        </li>
        <li>
          <strong>Anchor diversity (20%)</strong> — descriptive vs. vague link text.
        </li>
        <li>
          <strong>Structure (20%)</strong> — how well your links concentrate importance.
        </li>
      </ul>
    ),
  },
  {
    title: 'Peer benchmarks',
    blurb: 'See how your internal linking compares to thousands of similar sites.',
    explainSummary: 'Why compare?',
    explain: (
      <p>
        A grade means more in context. Benchmarks show whether your internal linking is ahead of or
        behind sites like yours — and where the easy wins are.
      </p>
    ),
  },
];

export function FeatureCards() {
  return (
    <section className="mx-auto mt-32 grid max-w-4xl gap-6 md:grid-cols-3">
      {FEATURES.map((f) => (
        <Card
          key={f.title}
          className="animate-reveal-up transition-shadow hover:shadow-raised motion-reduce:animate-none motion-reduce:transition-none"
        >
          <h3 className="font-display text-h3">{f.title}</h3>
          <p className="mt-2 text-body text-ink-muted">{f.blurb}</p>
          <Explainer className="mt-3" summary={f.explainSummary}>
            {f.explain}
          </Explainer>
        </Card>
      ))}
    </section>
  );
}

import type { ReactNode } from 'react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { GradeCard } from '../ui/GradeCard';
import { GradeCardSkeleton } from '../ui/GradeCardSkeleton';
import { Input } from '../ui/Input';

// Temporary look-review gallery for SPEC 03 Phase A (design-system elevation). Rendered by the
// /showcase route (noindex) for owner review on the branch preview; removed before the PR.

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="font-display text-h2">{title}</h2>
      {children}
    </section>
  );
}

function Swatch({ label, className }: { label: string; className: string }) {
  return (
    <div className="space-y-1">
      <div className={`h-16 rounded-card border border-oat ${className}`} />
      <div className="text-caption text-ink-muted">{label}</div>
    </div>
  );
}

export function Showcase() {
  return (
    <main className="min-h-screen bg-cream text-ink">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-12">
        <header className="space-y-2">
          <div className="text-overline uppercase text-ink-muted">Crawlmouse · SPEC 03 Phase A</div>
          <h1 className="font-display text-display leading-none">Design system</h1>
          <p className="max-w-2xl text-body-lg text-ink-muted">
            The elevated kit on the brand palette. Every component shows its real states; all text
            meets WCAG AA (the one visible change from before: brand fills carry ink text, not white).
          </p>
        </header>

        <Section title="Color roles">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Swatch label="surface (cream)" className="bg-cream" />
            <Swatch label="surface-raised" className="bg-surface-raised" />
            <Swatch label="oat" className="bg-oat" />
            <Swatch label="ink" className="bg-ink" />
            <Swatch label="ink-muted" className="bg-ink-muted" />
            <Swatch label="peach (accent)" className="bg-peach" />
            <Swatch label="peach-light" className="bg-peach-light" />
            <Swatch label="sage (positive)" className="bg-sage" />
            <Swatch label="warning" className="bg-warning" />
          </div>
          <p className="text-caption text-ink-muted">
            Accent <span className="font-semibold text-accent-text">text on cream</span> uses
            accent-text (#d8603a) for large/emphasis only — body text stays ink / ink-muted.
          </p>
        </Section>

        <Section title="Type scale">
          <div className="space-y-2">
            <div className="font-display text-display leading-none">Display</div>
            <div className="font-display text-h1">Heading 1</div>
            <div className="font-display text-h2">Heading 2</div>
            <div className="font-display text-h3">Heading 3</div>
            <div className="text-body-lg">Body large — the reading size for lead copy.</div>
            <div className="text-body">Body — default UI text.</div>
            <div className="text-caption text-ink-muted">Caption — labels and helper text.</div>
            <div className="text-overline uppercase text-ink-muted">Overline</div>
            <div className="font-mono text-body">Mono — scores &amp; URLs.</div>
          </div>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
            <Button loading>Loading</Button>
            <Button disabled>Disabled</Button>
          </div>
        </Section>

        <Section title="Cards">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <div className="text-overline uppercase text-ink-muted">default</div>
              <p className="mt-1 text-body">Flat surface — backward-compatible.</p>
            </Card>
            <Card variant="raised">
              <div className="text-overline uppercase text-ink-muted">raised</div>
              <p className="mt-1 text-body">Elevated with a soft shadow.</p>
            </Card>
            <Card variant="locked">
              <div className="text-overline uppercase text-ink-muted">locked</div>
              <p className="mt-1 text-body text-ink-muted">The visible-but-locked cure shell.</p>
            </Card>
            <Card interactive tabIndex={0}>
              <div className="text-overline uppercase text-ink-muted">interactive</div>
              <p className="mt-1 text-body">Hover, and Tab to me for the focus ring.</p>
            </Card>
          </div>
        </Section>

        <Section title="Badges">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="peach">Peach</Badge>
            <Badge tone="sage">Sage</Badge>
            <Badge tone="ink">Ink</Badge>
            <Badge tone="oat">Oat</Badge>
            <Badge tone="success">Success</Badge>
            <Badge tone="warning">Warning</Badge>
            <Badge tone="info">Info</Badge>
            <Badge tone="neutral">Neutral</Badge>
          </div>
        </Section>

        <Section title="Inputs">
          <div className="grid max-w-md gap-3">
            <Input placeholder="https://example.com" aria-label="Default input" />
            <Input placeholder="Invalid state" invalid aria-label="Invalid input" />
            <Input placeholder="Disabled" disabled aria-label="Disabled input" />
          </div>
        </Section>

        <Section title="Grade card">
          <div className="grid gap-4 sm:grid-cols-3">
            <GradeCard grade="A-" score={91} orphanCount={0} avgDepth={2.1} passing />
            <GradeCard grade="D+" score={48} orphanCount={37} avgDepth={5.3} passing={false} />
            <GradeCardSkeleton />
          </div>
        </Section>
      </div>
    </main>
  );
}

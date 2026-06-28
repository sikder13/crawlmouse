import Link from 'next/link';
import type { DashboardSite } from './dashboard-logic';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { SiteCard } from './SiteCard';

// The Pro dashboard body: the "what changed since last visit" feed — one SiteCard per site, each
// leading with its delta + sparkline + open-loop fixes + one-tap re-audit. Empty state nudges the
// first audit. (Plan/billing is composed by the page around this.)
export function DashboardView({ sites }: { sites: DashboardSite[] }) {
  if (sites.length === 0) {
    return (
      <Card variant="raised" className="text-center">
        <h3 className="font-display text-h3">No audits yet</h3>
        <p className="mx-auto mt-2 max-w-prose text-body text-ink-muted">
          Run your first audit, then come back to watch your grade climb.
        </p>
        <Link href={{ pathname: '/' }} className="mt-4 inline-block">
          <Button variant="primary">Run an audit</Button>
        </Link>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {sites.map((s) => (
        <SiteCard key={s.url} site={s} />
      ))}
    </div>
  );
}

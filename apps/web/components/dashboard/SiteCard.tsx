import Link from 'next/link';
import type { DashboardSite } from './dashboard-logic';
import { deltaArrow, deltaDirection } from './dashboard-logic';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { FixChecklist } from './FixChecklist';
import { ReauditButton } from './ReauditButton';
import { Sparkline } from './Sparkline';

// One site's "what changed since last visit" — the delta (C→B ▲), the grade-over-time sparkline, the
// open-loop fix checklist, and one-tap re-audit. The delta uses an AA badge (white/ink on a fill);
// the sparkline is colored by direction (a graphical line, 3:1 OK).
export function SiteCard({ site }: { site: DashboardSite }) {
  const dir = site.delta ? deltaDirection(site.delta.scoreDelta) : 'flat';
  const deltaTone = dir === 'up' ? 'success' : dir === 'down' ? 'warning' : 'neutral';
  const sparkColor = dir === 'up' ? 'text-sage' : dir === 'down' ? 'text-warning' : 'text-ink-muted';
  return (
    <Card variant="raised">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href={`/audit/${site.latestAuditId}`}
            className="block truncate font-mono text-body text-ink hover:underline"
          >
            {site.url}
          </Link>
          {site.delta ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone={deltaTone}>
                {site.delta.gradeFrom} → {site.delta.gradeTo} {deltaArrow(dir)}
              </Badge>
              <span className="text-caption text-ink-muted">
                {site.delta.scoreDelta > 0 ? '+' : ''}
                {site.delta.scoreDelta} since last run
              </span>
            </div>
          ) : (
            <p className="mt-2 text-caption text-ink-muted">First audit — re-audit later to track changes.</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="font-display text-h2 leading-none text-ink">{site.grade}</span>
          <span className={sparkColor}>
            <Sparkline scores={site.history.map((h) => h.score)} />
          </span>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-oat pt-3">
        <FixChecklist done={site.fixChecklist.done} total={site.fixChecklist.total} />
        <ReauditButton auditId={site.latestAuditId} />
      </div>
    </Card>
  );
}

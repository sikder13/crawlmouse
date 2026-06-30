import Link from 'next/link';
import type { DashboardSite } from './dashboard-logic';
import { deltaArrow, deltaDirection, deltaSentence, historySpanLabel } from './dashboard-logic';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { GradeGauge } from '../audit/GradeGauge';
import { FixChecklist } from './FixChecklist';
import { ReauditButton } from './ReauditButton';
import { Sparkline } from './Sparkline';

// One site's "what changed since last visit": the compact grade gauge (the SAME object as the result
// page, tier-colored for glanceability), a warm feels-known delta line, the grade-over-time sparkline
// + its time span, the open-loop fix checklist, and one-tap re-audit. Per the v1.2 contract, `delta` is
// a MonitoringDelta and `fixChecklist` is the Pro-owner-only cure tracker (null → the upgrade path).
export function SiteCard({ site }: { site: DashboardSite }) {
  const scoreDelta = site.delta?.scoreDelta ?? 0;
  const dir = site.delta ? deltaDirection(scoreDelta) : 'flat';
  const deltaTone = dir === 'up' ? 'success' : dir === 'down' ? 'warning' : 'neutral';
  const sparkColor = dir === 'up' ? 'text-sage' : dir === 'down' ? 'text-warning' : 'text-ink-muted';
  const span = historySpanLabel(site.history);
  return (
    <Card variant="raised">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href={`/audit/${site.latestAuditId}`}
            className="block truncate font-mono text-body text-ink hover:underline"
          >
            {site.siteUrl}
          </Link>
          {site.delta ? (
            <div className="mt-2 space-y-1">
              <Badge tone={deltaTone}>
                {site.delta.gradeFrom ?? '—'} → {site.delta.gradeTo} {deltaArrow(dir)}
              </Badge>
              <p className="text-caption text-ink-muted">{deltaSentence(site.delta.scoreDelta)}</p>
            </div>
          ) : (
            <p className="mt-2 text-caption text-ink-muted">First audit — re-audit later to watch it change.</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-center gap-1">
          <GradeGauge grade={site.currentGrade} score={site.currentScore} size="sm" />
          <span className={sparkColor}>
            <Sparkline scores={site.history.map((h) => h.score)} />
          </span>
          {span && <span className="text-overline uppercase text-ink-muted">{span}</span>}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-oat pt-3">
        {site.fixChecklist ? (
          <FixChecklist
            items={site.fixChecklist}
            doneCount={site.fixChecklistDoneCount ?? 0}
            auditId={site.latestAuditId}
            climb={
              site.delta && site.delta.scoreDelta != null && site.delta.scoreDelta > 0
                ? { from: site.delta.gradeFrom ?? '—', to: site.delta.gradeTo, points: site.delta.scoreDelta }
                : null
            }
          />
        ) : (
          // Pro-gated: a free signed-in owner keeps their site + delta, and gets the path to the cure tracker.
          <p className="min-w-0 flex-1 text-caption text-ink-muted">
            <span aria-hidden="true">🔒</span> Track which fixes are done with{' '}
            <Link href={{ pathname: '/pricing' }} className="font-medium text-ink underline">
              Pro
            </Link>
          </p>
        )}
        <ReauditButton auditId={site.latestAuditId} />
      </div>
    </Card>
  );
}

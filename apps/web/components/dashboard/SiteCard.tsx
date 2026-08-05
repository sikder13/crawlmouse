import Link from 'next/link';
import type { DashboardSite } from './dashboard-logic';
import { absoluteTime, deltaArrow, deltaDirection, deltaSentence, historySpanLabel, relativeTime } from './dashboard-logic';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { GradeGauge } from '../audit/GradeGauge';
import { FixChecklist } from './FixChecklist';
import { ReauditButton } from './ReauditButton';
import { Sparkline } from './Sparkline';
import { ReportBrandingSettings } from './ReportBrandingSettings';
import type { SiteReportSettings } from '@/lib/dashboard-report-settings';
import { safeDecodeUrlForDisplay } from '@/lib/url-display';
import { NO_GRADE_LABEL, refusalCopy } from '@/lib/refusal-copy';

// One site's "what changed since last visit": the compact grade gauge (the SAME object as the result
// page, tier-colored for glanceability), a warm feels-known delta line, the grade-over-time sparkline
// + its time span, the open-loop fix checklist, and one-tap re-audit. Per the v1.2 contract, `delta` is
// a MonitoringDelta and `fixChecklist` is the Pro-owner-only cure tracker (null → the upgrade path).
export function SiteCard({ site, reportSettings }: { site: DashboardSite; reportSettings?: SiteReportSettings }) {
  // SPEC 5.1a Stage 4 — the latest audit's verdict, or null when the refusal gate withheld one. Bound
  // as a NARROWED value rather than a boolean flag so the gauge below cannot be reached without both
  // halves: a half-written row must not render half a verdict, and the compiler is what guarantees it.
  const verdict =
    site.currentGrade !== null && site.currentScore !== null
      ? { grade: site.currentGrade, score: site.currentScore }
      : null;
  // The dashboard card shows the HEADLINE only — the same selector the result page uses, so the two
  // can never tell the owner different stories about the same audit. `refusal` is not on DashboardSite
  // yet, so this is the no-trigger fallback until the dashboard query selects it; the seam is the
  // same one either way.
  const refusalHeadline = refusalCopy({ triggers: [] }).headline;
  const scoreDelta = site.delta?.scoreDelta ?? 0;
  const dir = site.delta ? deltaDirection(scoreDelta) : 'flat';
  const deltaTone = dir === 'up' ? 'success' : dir === 'down' ? 'warning' : 'neutral';
  const sparkColor = dir === 'up' ? 'text-sage' : dir === 'down' ? 'text-warning' : 'text-ink-muted';
  const span = historySpanLabel(site.history);
  // Latest audit's timestamp — the last history point is the current audit (present even on a first
  // audit, where `delta` is null), so this is the robust "last audited" source.
  const lastAuditedAt = site.history[site.history.length - 1]?.ranAt ?? '';
  return (
    <Card variant="raised">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href={`/audit/${site.latestAuditId}`}
            className="block truncate font-mono text-body text-ink hover:underline"
          >
            {safeDecodeUrlForDisplay(site.siteUrl)}
          </Link>
          {lastAuditedAt && (
            <p className="mt-1 text-caption text-ink-muted" title={absoluteTime(lastAuditedAt)}>
              Audited {relativeTime(lastAuditedAt, new Date())}
            </p>
          )}
          {verdict === null ? (
            // A withheld verdict is NOT a movement, so it gets no delta badge and no arrow. Rendering
            // "B+ → —  ▼" in the warning tone would report a decline we never measured, on the one
            // surface whose whole job is telling an owner what changed.
            <p className="mt-2 text-caption text-ink-muted">{refusalHeadline}</p>
          ) : site.delta ? (
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
          {verdict === null ? (
            // Neutral tone, never the failing tone: a refusal is an absence of a verdict, not a bad
            // one. No gauge at all rather than a gauge showing nothing — an empty dial still reads as
            // a measurement of zero.
            <span className="text-caption font-medium uppercase tracking-wide text-ink-muted">
              {NO_GRADE_LABEL}
            </span>
          ) : (
            <GradeGauge grade={verdict.grade} score={verdict.score} size="sm" />
          )}
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
              // Only celebrate a visible (≥1 pt) gain so a sub-0.5 float climb never renders "(+0)".
              // `gradeTo` is checked explicitly rather than defaulted: there is no climb to celebrate
              // into a verdict we withheld, and a `?? '—'` here would put a dash where a letter goes.
              site.delta && site.delta.scoreDelta != null && site.delta.gradeTo != null && Math.round(site.delta.scoreDelta) >= 1
                ? { from: site.delta.gradeFrom ?? '—', to: site.delta.gradeTo, points: Math.round(site.delta.scoreDelta) }
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
      {/* §3 dashboard — the durable home for report branding + visibility (claimed, owned reports). */}
      {reportSettings && <ReportBrandingSettings slug={reportSettings.slug} settings={reportSettings} />}
    </Card>
  );
}

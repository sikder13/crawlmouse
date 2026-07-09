import type { PublicReportSnapshot } from '@crawlmouse/types';
import { GradeCard } from '@/components/ui/GradeCard';
import { findingMeta } from '@/components/audit/finding-meta';
import { isPassingScore } from '@/lib/limits';
import { buildExecutiveSummary, summarizeFindings, buildMethodology } from '@/lib/report-content';
import { impactLabel } from '@/lib/impact-label';
import { safeDecodeUrlForDisplay } from '@/lib/url-display';

// SPEC 04 §4 — the client-ready report's self-contained sections (the frozen SPEC 05 seam). Every
// section takes only the snapshot, so SPEC 05 adds its section to ReportBody's ordered list without
// editing any of these. Cure gating is STRUCTURAL: the snapshot has no prescription data, so nothing
// gated can render. Every crawled string (domain / targetUrl / targetTitle) is a plain React text
// node — escaped by construction; no dangerouslySetInnerHTML anywhere.

const H2 = 'font-display font-semibold text-lg mb-3';

export function ReportGradeSection({ snapshot }: { snapshot: PublicReportSnapshot }) {
  return (
    <section aria-labelledby="report-grade" className="mt-6">
      <h2 id="report-grade" className="sr-only">Grade</h2>
      <GradeCard
        grade={snapshot.grade}
        score={snapshot.score}
        orphanCount={snapshot.orphanCount}
        avgDepth={snapshot.avgDepth ?? 0}
        passing={isPassingScore(snapshot.score)}
      />
    </section>
  );
}

export function ReportExecutiveSummary({ snapshot }: { snapshot: PublicReportSnapshot }) {
  const sentences = buildExecutiveSummary(snapshot);
  return (
    <section aria-labelledby="report-summary" className="mt-8">
      <h2 id="report-summary" className={H2}>Executive summary</h2>
      <p className="text-ink/80 leading-relaxed">{sentences.join(' ')}</p>
    </section>
  );
}

export function ReportFindings({ snapshot }: { snapshot: PublicReportSnapshot }) {
  const groups = summarizeFindings(snapshot);
  if (groups.length === 0) return null; // a clean site has no findings section (never fabricate)
  return (
    <section aria-labelledby="report-findings" className="mt-8">
      <h2 id="report-findings" className={H2}>What we found</h2>
      <ul className="space-y-4">
        {groups.map((g) => (
          <li key={g.category} className="border border-oat rounded-xl p-4 bg-white">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-display font-semibold">{g.label}</span>
              <span className="font-mono text-sm text-ink/50">×{g.count}</span>
            </div>
            <p className="mt-1 text-sm text-ink/80">{g.what}</p>
            <p className="mt-1 text-sm text-ink/55">{g.why}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ReportActionList({ snapshot }: { snapshot: PublicReportSnapshot }) {
  const { ledger, ledgerDisclaimer } = snapshot;
  if (ledger.length === 0) return null;
  return (
    <section aria-labelledby="report-actions" className="mt-8">
      <h2 id="report-actions" className={H2}>Prioritised fixes</h2>
      {/* Per-fix impacts are individual estimates — rendered standalone, NEVER summed (SPEC 02 §3). */}
      <p className="text-xs text-ink/55 mb-3">{ledgerDisclaimer}</p>
      <ol className="space-y-3">
        {ledger.map((item, i) => (
          <li key={`${item.targetUrl}#${i}`} className="border border-oat rounded-xl p-4 bg-white">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-display font-semibold">{findingMeta(item.category).label}</span>
              <span className="font-mono text-sm text-peach">{impactLabel(item.marginalDelta)}</span>
            </div>
            {/* SPEC 04.2 FIX 3c — DISPLAY-ONLY decode of the crawled fix URL (non-ASCII paths leaked "%e0…"
                here). The snapshot value is untouched; still an inert React text node. */}
            <div className="mt-1 font-mono text-xs text-ink/60 break-all">{item.targetTitle || safeDecodeUrlForDisplay(item.targetUrl)}</div>
            <div className="mt-1 text-xs text-ink/50 capitalize">Effort: {item.effort}</div>
            {item.rationale && <p className="mt-2 text-sm text-ink/75">{item.rationale}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function ReportMethodology({ snapshot }: { snapshot: PublicReportSnapshot }) {
  return (
    <section aria-labelledby="report-method" className="mt-8">
      <h2 id="report-method" className={H2}>Methodology &amp; confidence</h2>
      <p className="text-sm text-ink/70 leading-relaxed">{buildMethodology(snapshot)}</p>
    </section>
  );
}

export function ReportFooter({ snapshot, claimed }: { snapshot: PublicReportSnapshot; claimed: boolean }) {
  const asOf = snapshot.mintedAt.slice(0, 10); // deterministic YYYY-MM-DD (no locale/tz variance)
  return (
    <footer className="report-footer mt-10 border-t border-oat pt-6 text-xs text-ink/55 space-y-2">
      {!claimed && (
        <p className="font-medium text-ink/70">Unverified — automated report. The domain owner has not claimed it.</p>
      )}
      <p>
        Automated, deterministic analysis of publicly served HTML, as of {asOf}. Results are a
        point-in-time snapshot — <a href="/" className="underline">run a fresh audit</a>.{' '}
        <a href="/bot" className="underline">Methodology</a>.
      </p>
      <p>
        <a href="/takedown" className="underline">Dispute or request removal</a>.
      </p>
    </footer>
  );
}

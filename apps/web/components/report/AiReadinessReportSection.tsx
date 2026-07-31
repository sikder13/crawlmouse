import type { ReportSnapshotAiFinding, PublicReportSnapshot } from '@crawlmouse/types';
import { AI_FINDING_SEVERITY_RANK, ownProp, rankIn } from '@crawlmouse/types';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { bandMeta, componentBars, evidenceLabel, partitionRetrievalBots } from '@/components/ai/ai-view-logic';
import { TrackView } from '@/components/analytics/TrackView';
import { safeDecodeUrlForDisplay } from '@/lib/url-display';

// SPEC 05 §10 (amendment v1.3) — the AI/agent-readiness section of the client-ready public report.
//
// DIAGNOSTIC-ONLY by construction: it reads `snapshot.aiReadiness`, which carries the score, the four
// LOCKED-weight components, the findings ledger, the access matrix and the llms.txt status — and nothing
// else. There is no per-page excerpt, no simulator and no packet in `AiReadinessScore`, so the report's
// cure gating stays STRUCTURAL: nothing gated can render because nothing gated is in the data.
//
// NULL-SAFE: a report minted before SPEC 05 has no `aiReadiness` key, so this returns null and the report
// renders exactly as it did (A13). Server-rendered — the report page is ISR (`revalidate=300`), so this
// section holds no client state and reads no entitlement. Its ONE client island is the fire-once
// `TrackView` below, whose props are snapshot-derived (not viewer-derived), so the cached HTML stays
// viewer-agnostic.
//
// Every crawled string (plainLanguage / bot notes / titles / urls) is a plain JSX text node — escaped by
// construction, never dangerouslySetInnerHTML (A14/§12). Copy never promises rankings or citations (A16).

/** Findings shown inline; the rest are counted, never silently dropped (§2 honesty). */
export const REPORT_AI_MAX_FINDINGS = 6;

const SEVERITY_TONE: Record<ReportSnapshotAiFinding['severity'], BadgeTone> = { high: 'warning', medium: 'info', info: 'neutral' };
/**
 * Own-property reads, both of them. `severity` is written VERBATIM from the unvalidated
 * `audits.ai_readiness` jsonb into the minted snapshot (`lib/report-snapshot.ts`), so the reader of a
 * FROZEN, world-readable, indexable artifact is the last place that should trust it. A plain index
 * resolves `__proto__`/`constructor`/`toString` through the prototype chain: the sort comparator
 * returns NaN — normalised to `+0`, so the value compares equal to everything and the order around it
 * is corrupted (info findings above high, permanently) — and the tone
 * lookup yields a FUNCTION that reaches `TONES[tone]` in Badge as a malformed className.
 *
 * This was the fifth copy of a rank map that a previous pass consolidated to one — and the copy on
 * the permanent artifact, i.e. the instance that pass called the most consequential. Sorting is
 * shared with every other AI cap now; only the presentation tone stays local.
 */
const toneFor = (s: string): BadgeTone => ownProp(SEVERITY_TONE, s) ?? 'neutral';

const H2 = 'font-display font-semibold text-lg mb-3';

export function AiReadinessReportSection({ snapshot }: { snapshot: PublicReportSnapshot }) {
  const ai = snapshot.aiReadiness;
  if (!ai) return null; // pre-SPEC-05 report, or an audit with no AI data — render nothing (A13)

  const band = bandMeta(ai.band);
  const bars = ai.components ? componentBars(ai) : [];
  // Defensive reads throughout: a minted snapshot is FROZEN and outlives the code that wrote it, and it
  // can never be migrated. A shape drift (a renamed band, a dropped array) must degrade, not 500 a
  // public, indexable page forever. Same discipline as SPEC 04's `findingMeta` fallback.
  const { canReach: reachingBots, blocked: blockedBots } = partitionRetrievalBots(
    Array.isArray(ai.accessMatrix?.bots) ? ai.accessMatrix.bots : [],
  );

  // Deterministic: stable severity sort (no clock, no locale) so the same snapshot always renders the
  // same list — the report is a frozen artifact and must not drift between renders.
  const ordered = [...(ai.findings ?? [])].sort(
    (a, b) => rankIn(AI_FINDING_SEVERITY_RANK, a.severity) - rankIn(AI_FINDING_SEVERITY_RANK, b.severity),
  );
  const shown = ordered.slice(0, REPORT_AI_MAX_FINDINGS);
  // Count from the PRE-CAP total the snapshot carries, not from the capped array — the snapshot keeps at
  // most MAX_AI_FINDINGS, so `ordered.length` would badly under-report on a large site.
  const withheld = Math.max(0, (ai.totalFindings ?? ordered.length) - shown.length);

  return (
    <section aria-labelledby="report-ai" className="mt-8">
      {/* §14 — the viral-surface counterpart of `ai_score_revealed`: this fires on a SHARED report,
          where the viewer is usually not the site owner. A fire-once client island (the same pattern as
          ReferralCapture), so the page stays ISR and the cached HTML stays viewer-agnostic. It sits
          inside the early-return, so a report without AI data can never emit it. */}
      <TrackView event="ai_report_section_viewed" props={{ band: ai.band, confidence: ai.confidence }} />
      <h2 id="report-ai" className={H2}>AI &amp; agent readiness</h2>

      <div className="border border-oat rounded-xl p-4 bg-white">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-display text-3xl">{ai.score}</span>
          <span className="text-sm text-ink/55">/ 100</span>
          <Badge tone={band.tone}>{band.label}</Badge>
        </div>
        <p className="mt-2 text-sm text-ink/70 leading-relaxed">
          How much of this site an AI assistant or agent can actually read and reach without running
          JavaScript. It is a separate measure from the internal-linking grade above — the two are never
          blended.
        </p>
        <p className="mt-2 text-xs text-ink/55">
          {ai.isEstimate
            ? `An estimate — based on ${ai.basis?.pagesAnalyzed ?? 0} pages analysed at ${ai.confidence} crawl confidence.`
            : `Based on ${ai.basis?.pagesAnalyzed ?? 0} pages analysed at ${ai.confidence} crawl confidence.`}
        </p>
      </div>

      <h3 className="font-display font-semibold mt-6 mb-2">What makes up the score</h3>
      <ul className="space-y-2">
        {bars.map((b) => (
          <li key={b.key} className="border border-oat rounded-lg px-4 py-3 bg-white">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm">{b.label}</span>
              <span className="font-mono text-sm text-ink/70">
                {b.pct}% <span className="text-ink/45">· weight {b.weight}</span>
              </span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-oat overflow-hidden" aria-hidden="true">
              <div className="h-full bg-peach-light" style={{ width: `${b.pct}%` }} />
            </div>
          </li>
        ))}
      </ul>

      {shown.length > 0 && (
        <>
          <h3 className="font-display font-semibold mt-6 mb-2">What we found</h3>
          <ul className="space-y-3">
            {shown.map((f, i) => (
              <li key={`${f.kind}:${f.targetUrl ?? ''}:${i}`} className="border border-oat rounded-xl p-4 bg-white">
                <div className="flex items-baseline justify-between gap-3">
                  <Badge tone={toneFor(f.severity)}>{f.severity}</Badge>
                  <span className="text-xs text-ink/50">{evidenceLabel(f.evidence)}</span>
                </div>
                <p className="mt-2 text-sm text-ink/80">{f.plainLanguage}</p>
                {f.targetUrl && (
                  <p className="mt-1 font-mono text-xs text-ink/50 break-all">
                    {safeDecodeUrlForDisplay(f.targetUrl)}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {withheld > 0 && (
            <p className="mt-2 text-xs text-ink/55">
              …and {withheld} more findings, not listed here.
            </p>
          )}
        </>
      )}

      <h3 className="font-display font-semibold mt-6 mb-2">AI crawler access</h3>
      <div className="border border-oat rounded-xl p-4 bg-white text-sm text-ink/80 space-y-2">
        <p>
          {ai.accessMatrix?.robotsTxtFound
            ? 'Read from this site’s robots.txt.'
            : 'No robots.txt was found, so crawlers are treated as allowed.'}
        </p>
        {/* Same two-group partition as the result page. The report previously listed ONLY restricted
            bots, so a reader learned who was blocked but never who could actually reach the site —
            the positive half of the access story was simply absent from the permanent artifact. */}
        {reachingBots.length > 0 ? (
          <div>
            <div className="font-semibold text-ink">Can reach your pages</div>
            <ul className="mt-1 space-y-1">
              {reachingBots.map((b) => (
                <li key={b.token}>
                  <span className="font-mono text-xs">{b.token}</span>{' '}
                  <span className="text-ink/55">({b.operator})</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {blockedBots.length > 0 ? (
          <div>
            <div className="font-semibold text-ink">Blocked or restricted</div>
            <ul className="mt-1 space-y-1">
              {blockedBots.map((b) => (
                <li key={b.token}>
                  <span className="font-mono text-xs">{b.token}</span>{' '}
                  <span className="text-ink/55">({b.operator})</span> — {b.note}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {reachingBots.length === 0 && blockedBots.length === 0 ? (
          <p className="text-ink/55">No AI retrieval crawler data is available for this site.</p>
        ) : null}
        {ai.accessMatrix?.wafDetected && ai.accessMatrix.wafNote && (
          // §2/§3 — disclosure only. WAF presence NEVER moves the score; it is surfaced so the reader
          // knows robots.txt may not be the whole story.
          <p className="text-xs text-ink/55">{ai.accessMatrix.wafNote}</p>
        )}
      </div>

      <p className="mt-4 text-xs text-ink/55">{ai.llmsTxt?.note}</p>
      <p className="mt-1 text-xs text-ink/55">
        AI-crawler behaviour as of {ai.asOf}. This measures machine legibility and reachability only — not
        how any AI product chooses to use the site.
      </p>
    </section>
  );
}

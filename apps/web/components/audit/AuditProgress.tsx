'use client';

interface Props {
  pageCount: number;
  pageCap: number;
  status: string;
  /** SPEC 04 §2 — live count from real activity events (null/absent before the first fetch). */
  pagesCrawled?: number | null;
  /** Honest sitemap-derived site total; absent = not derivable (never invented). */
  estimatedTotal?: number | null;
  /** Current real pipeline phase, from phase events. */
  phase?: string | null;
  /** Honest stall state: no events for a while — displayed, never masked with fake motion. */
  stalled?: boolean;
}

const PHASE_LABEL: Record<string, string> = {
  crawling: 'Crawling',
  analyzing: 'Analyzing',
  grading: 'Grading',
  persisting: 'Saving report',
};

/**
 * SPEC 04 §2 — determinate, honest progress. The bar renders ONLY numbers real events produced:
 * "N of ~M" when a sitemap gave an honest total, otherwise "N so far · cap C". It advances only
 * when props change (i.e. on real events); a stall shows a truthful stalled line. The legacy
 * page_count path (persisted at completion) is preserved for terminal snapshots.
 */
export function AuditProgress({ pageCount, pageCap, status, pagesCrawled, estimatedTotal, phase, stalled }: Props) {
  const live = typeof pagesCrawled === 'number' && pagesCrawled > 0;
  const hasLegacyCount = pageCount > 0;

  // The honest denominator: the sitemap total when we have one (clamped by the cap we'll actually
  // crawl), else the cap itself. Only used to SIZE the bar; the copy never invents a total.
  const denominator = live ? Math.max(1, Math.min(estimatedTotal ?? pageCap, pageCap)) : pageCap;
  const pct = live
    ? Math.min(100, Math.round(((pagesCrawled as number) / denominator) * 100))
    : hasLegacyCount
      ? Math.min(100, Math.round((pageCount / pageCap) * 100))
      : 0;

  const headline = PHASE_LABEL[phase ?? ''] ?? (status === 'pending' ? 'Starting' : status);

  return (
    <div className="bg-white border border-oat rounded-2xl p-5">
      <div className="flex items-baseline justify-between mb-2">
        <div className="font-display font-semibold text-lg capitalize">{headline}</div>
        <div className="font-mono text-sm text-ink/60">
          {live && estimatedTotal != null && <span>{pagesCrawled} of ~{estimatedTotal} pages</span>}
          {live && estimatedTotal == null && <span>{pagesCrawled} pages so far · cap {pageCap}</span>}
          {!live && hasLegacyCount && <span>{pageCount} / {pageCap} pages</span>}
          {!live && !hasLegacyCount && <span>Starting the crawl…</span>}
        </div>
      </div>
      <div className="h-2 bg-oat rounded-full overflow-hidden">
        {live || hasLegacyCount ? (
          <div data-testid="progress-bar" className="h-full bg-peach transition-all" style={{ width: `${pct}%` }} />
        ) : (
          <div className="h-full w-2/5 bg-peach rounded-full animate-pulse" />
        )}
      </div>
      {stalled && (
        <p className="mt-2 text-sm text-ink/60">
          Waiting politely — this site is responding slowly or rate-limits crawlers. Progress resumes as pages arrive.
        </p>
      )}
    </div>
  );
}

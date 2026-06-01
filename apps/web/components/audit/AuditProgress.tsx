'use client';

interface Props { pageCount: number; pageCap: number; status: string }

export function AuditProgress({ pageCount, pageCap, status }: Props) {
  // page_count is only persisted once the crawl finishes, so while crawling we show an
  // honest indeterminate bar rather than a fake 0% that never moves.
  const hasCount = pageCount > 0;
  const pct = hasCount ? Math.min(100, Math.round((pageCount / pageCap) * 100)) : 0;
  return (
    <div className="bg-white border border-oat rounded-2xl p-5">
      <div className="flex items-baseline justify-between mb-2">
        <div className="font-display font-semibold text-lg capitalize">{status}</div>
        <div className="font-mono text-sm text-ink/60">
          {hasCount ? `${pageCount} / ${pageCap} pages` : 'Crawling your site…'}
        </div>
      </div>
      <div className="h-2 bg-oat rounded-full overflow-hidden">
        {hasCount
          ? <div className="h-full bg-peach transition-all" style={{ width: `${pct}%` }} />
          : <div className="h-full w-2/5 bg-peach rounded-full animate-pulse" />}
      </div>
    </div>
  );
}

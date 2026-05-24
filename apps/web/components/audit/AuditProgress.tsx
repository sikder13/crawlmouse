'use client';

interface Props { pageCount: number; pageCap: number; status: string }

export function AuditProgress({ pageCount, pageCap, status }: Props) {
  const pct = Math.min(100, Math.round((pageCount / pageCap) * 100));
  return (
    <div className="bg-white border border-oat rounded-2xl p-5">
      <div className="flex items-baseline justify-between mb-2">
        <div className="font-display font-semibold text-lg capitalize">{status}</div>
        <div className="font-mono text-sm text-ink/60">{pageCount} / {pageCap} pages</div>
      </div>
      <div className="h-2 bg-oat rounded-full overflow-hidden">
        <div className="h-full bg-peach transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

import { checklistRemaining } from './dashboard-logic';

// The open-loop fix checklist ("3 of 7 done · 4 to go") — the unfinished-task pull that brings Pro
// users back. AA: progress conveyed by text + an aria progressbar, not color alone.
export function FixChecklist({ done, total }: { done: number; total: number }) {
  const remaining = checklistRemaining(done, total);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between gap-3 text-caption">
        <span className="font-medium text-ink">
          {done} of {total} fixes done
        </span>
        {remaining > 0 && <span className="font-medium text-ink">{remaining} to go</span>}
      </div>
      <div
        className="mt-1 h-2 w-full overflow-hidden rounded-full bg-oat"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label="Fixes completed"
      >
        <div className="h-full rounded-full bg-sage-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

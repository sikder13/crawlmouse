import Link from 'next/link';
import type { DashboardFixChecklistItem } from './dashboard-logic';
import { checklistRemaining } from './dashboard-logic';
import { relativeImpactLabel } from '../audit/result-logic';

// The open-loop cure tracker (Pro owner): the summary ("4 of 7 fixes done · 3 to go") doubles as a
// native <details> expander that closes the loop — DONE fixes tied to the REAL grade climb that
// occurred (honest, provable), REMAINING fixes with their ESTIMATED point impact (clearly "est.",
// never summed), each linking to its cure on the audit page. The full cure (links/action packet)
// lives on /audit/[id]; this only links there. done/remaining is computed from the re-audit diff
// (item.resolved), never a manual toggle.
export function FixChecklist({
  items,
  doneCount,
  auditId,
  climb,
}: {
  items: DashboardFixChecklistItem[];
  doneCount: number;
  auditId: string;
  // The real grade movement since last visit — present only when the grade actually climbed, so the
  // "these fixes lifted your grade" claim is provable (null on a flat/regressed/first audit).
  climb: { from: string; to: string; points: number } | null;
}) {
  const total = items.length;
  const remaining = checklistRemaining(doneCount, total);
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
  const done = items.filter((i) => i.resolved);
  const todo = items.filter((i) => !i.resolved);

  return (
    <details className="group min-w-0 flex-1">
      <summary className="cursor-pointer list-none rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-peach focus-visible:ring-offset-2 focus-visible:ring-offset-cream">
        <div className="flex items-center justify-between gap-3 text-caption">
          <span className="inline-flex items-center gap-1 font-medium text-ink">
            <span aria-hidden="true" className="transition-transform group-open:rotate-90 motion-reduce:transition-none">
              ›
            </span>
            {doneCount} of {total} fixes done
          </span>
          {remaining > 0 && <span className="font-medium text-ink">{remaining} to go</span>}
        </div>
        <div
          className="mt-1 h-2 w-full overflow-hidden rounded-full bg-oat"
          role="progressbar"
          aria-valuenow={doneCount}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label="Fixes completed"
        >
          <div className="h-full rounded-full bg-sage-fill" style={{ width: `${pct}%` }} />
        </div>
      </summary>

      <div className="mt-3 space-y-3">
        {done.length > 0 && (
          <div>
            <div className="text-overline uppercase text-ink-muted">
              {climb
                ? `These fixes lifted your grade ${climb.from} → ${climb.to} (+${climb.points})`
                : 'Already fixed'}
            </div>
            <ul className="mt-1 space-y-1">
              {done.map((item) => (
                <li key={item.fixId} className="flex items-start gap-2 text-caption">
                  <span aria-hidden="true" className="text-sage-fill">
                    ✓
                  </span>
                  <Link href={{ pathname: `/audit/${auditId}` }} className="text-ink hover:underline">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {todo.length > 0 && (
          <div>
            <div className="text-overline uppercase text-ink-muted">Still to do</div>
            <ul className="mt-1 space-y-1">
              {todo.map((item) => (
                <li key={item.fixId} className="flex items-start justify-between gap-3 text-caption">
                  <Link href={{ pathname: `/audit/${auditId}` }} className="text-ink hover:underline">
                    {item.label}
                  </Link>
                  <span className="shrink-0 font-mono text-ink-muted">{relativeImpactLabel(item.marginalDelta)} est.</span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-caption text-ink-muted">
              Per-fix impacts are estimates; they do not add up (fixes are not independent).
            </p>
          </div>
        )}
      </div>
    </details>
  );
}

import type { Sample } from './samples.js';
import { fmt, median } from './stats.js';

/** How many earlier nightlies a trend line compares against. */
export const TREND_NIGHTLIES = 7;

const percent = (now: number, then: number): string => {
  if (then === 0) return now === 0 ? '0%' : 'new';
  const p = Number((((now - then) / then) * 100).toFixed(1));
  return p > 0 ? `+${p}%` : p < 0 ? `−${-p}%` : '0%';
};

/**
 * One line per metric measured tonight: its median against the medians the last TREND_NIGHTLIES
 * nightlies read for it. `history` is newest first, one list of samples per nightly. A metric the
 * latest nightly measured and tonight did not gets a line of its own.
 */
export function trendLines(current: Sample[], history: Sample[][]): string[] {
  const recent = history.slice(0, TREND_NIGHTLIES);
  const lines = current.map((c) => {
    const over = c.median < c.limit ? '' : ', OVER';
    const head = `- ${c.metric}: ${fmt(c.median)} ${c.unit} (limit ${fmt(c.limit)}${over})`;
    const past = recent.flatMap((run) =>
      run.filter((s) => s.metric === c.metric).map((s) => s.median),
    );
    if (past.length === 0) return `${head} · no earlier nightly to compare`;
    const mid = median(past);
    const word = past.length === 1 ? 'nightly' : 'nightlies';
    return (
      `${head} · last ${past.length} ${word}: median ${fmt(mid)}, ` +
      `range ${fmt(Math.min(...past))}–${fmt(Math.max(...past))} · ${percent(c.median, mid)}`
    );
  });
  const tonight = new Set(current.map((c) => c.metric));
  const gone = (recent[0] ?? []).filter((s) => !tonight.has(s.metric));
  return [
    ...lines,
    ...gone.map(
      (s) => `- ${s.metric}: not measured tonight (last nightly: ${fmt(s.median)} ${s.unit})`,
    ),
  ];
}

import { ScrollRegion } from './ScrollRegion';
import layout from './layout.module.css';
import styles from './GradeHistory.module.css';

export interface GradeSeries {
  /** "Technical SEO". */
  name: string;
  /** One score (0–100) per check, or null where the check gave none. */
  values: readonly (number | null)[];
  /** Drawn dashed: the second series, so the two differ by more than colour. */
  dashed?: boolean;
}

export interface GradeHistoryProps {
  /** Names the chart's scroll region and its table. */
  label: string;
  /** One axis label per check: "24 Oct", "26", "Thu 29". */
  labels: readonly string[];
  /** One date per check, in full, for the table the chart is read from. */
  dates: readonly string[];
  series: readonly [GradeSeries, GradeSeries];
  /** What the chart shows, in a sentence: the table's caption. */
  caption: string;
  /** A note above a series' first run: "AI readability · 41 since the first audit". */
  note?: { series: 0 | 1; text: string } | null;
  /**
   * A marked point, drawn in the bad tone: "Claude-SearchBot and ClaudeBot blocked · 22", with the
   * verdicts its words name, so a test can hold "blocked" to them.
   */
  marker?: { series: 0 | 1; index: number; text: string; verdicts?: readonly string[] } | null;
}

const W = 640;
const H = 186;
const X0 = 40;
const X1 = 630;
const TICKS = [100, 75, 50, 25];
const y = (v: number) => 20 + (100 - v) * 1.6;

/** The runs of consecutive scores, each as polyline points; a null breaks the line. */
function segments(values: readonly (number | null)[], xs: readonly number[]): string[] {
  const out: string[] = [];
  let run: string[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (run.length) out.push(run.join(' '));
      run = [];
    } else run.push(`${xs[i]},${y(v)}`);
  });
  if (run.length) out.push(run.join(' '));
  return out;
}

/**
 * Two grades across a site's checks, as an inline SVG. The drawing is hidden from assistive
 * technology; the table under it, read instead, lists every value at every check (D9).
 */
export function GradeHistory({
  label,
  labels,
  dates,
  series,
  caption,
  note,
  marker,
}: GradeHistoryProps) {
  const n = labels.length;
  if (n < 2) throw new Error(`GradeHistory "${label}": two checks at least, got ${n}`);
  for (const s of series) {
    if (s.values.length !== n) {
      throw new Error(
        `GradeHistory "${label}": ${s.name} has ${s.values.length} values for ${n} checks`,
      );
    }
    for (const v of s.values) {
      if (v !== null && !(Number.isFinite(v) && v >= 0 && v <= 100)) {
        throw new Error(`GradeHistory "${label}": ${s.name} has a score outside 0–100: ${v}`);
      }
    }
  }
  if (dates.length !== n)
    throw new Error(`GradeHistory "${label}": ${dates.length} dates for ${n} checks`);
  const xs = labels.map((_, i) => X0 + (i * (X1 - X0)) / (n - 1));
  const first = (s: 0 | 1) => series[s].values.find((v): v is number => v !== null);
  const marked = marker ? series[marker.series].values[marker.index] : null;

  return (
    <div className={styles.history}>
      <ScrollRegion label={label} className={styles.scroll} startAtEnd>
        <svg
          className={styles.chart}
          data-v2-chart=""
          viewBox={`0 0 ${W} ${H}`}
          aria-hidden="true"
          focusable="false"
        >
          <g className={styles.grid}>
            {TICKS.map((t) => (
              <line key={t} x1={X0} y1={y(t)} x2={X1} y2={y(t)} />
            ))}
          </g>
          <g className={styles.ticks}>
            {TICKS.map((t) => (
              <text key={t} x={t === 100 ? 8 : 14} y={y(t) + 4}>
                {t}
              </text>
            ))}
          </g>
          {series.map((s, i) =>
            segments(s.values, xs).map((points) => (
              <polyline
                key={`${i}-${points}`}
                className={i === 0 ? styles.first : styles.second}
                points={points}
                strokeDasharray={s.dashed ? '4 3' : undefined}
              />
            )),
          )}
          {note && first(note.series) !== undefined ? (
            <text
              className={styles.note}
              x={xs[n - 2]! - 12}
              y={y(first(note.series)!) - 5}
              textAnchor="end"
            >
              {note.text}
            </text>
          ) : null}
          {marker && marked !== null && marked !== undefined ? (
            <>
              <rect
                className={styles.marker}
                x={xs[marker.index]! - 4}
                y={y(marked) - 4}
                width={8}
                height={8}
              />
              <text
                className={styles.note}
                x={xs[marker.index]! - 8}
                y={y(marked) + 15}
                textAnchor="end"
              >
                {marker.text}
              </text>
            </>
          ) : null}
          <g className={styles.ticks}>
            {labels.map((l, i) => (
              <text
                key={i}
                x={xs[i]}
                y={180}
                textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
              >
                {l}
              </text>
            ))}
          </g>
        </svg>
      </ScrollRegion>
      {/* A table ignores a 1px width; the box around it holds the screen-reader-only size. */}
      <div className={layout.srOnly} data-v2-sr-only="">
        <table className={styles.values}>
          {/* Everything the drawing writes on itself, besides its axis, is read here too. */}
          <caption>
            {[caption, note?.text].filter(Boolean).join('. ')}
            {marker ? (
              <>
                {'. '}
                <span data-v2-verdicts={(marker.verdicts ?? []).join(' ')}>{marker.text}</span>
              </>
            ) : null}
          </caption>
          <thead>
            <tr>
              <th scope="col">Check</th>
              {series.map((s) => (
                <th key={s.name} scope="col">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dates.map((d, i) => (
              <tr key={i}>
                <th scope="row">{d}</th>
                {series.map((s) => (
                  <td key={s.name}>{s.values[i] ?? 'not graded'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

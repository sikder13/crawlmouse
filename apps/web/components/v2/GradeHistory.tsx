import { useId, type CSSProperties } from 'react';
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
  /** One axis label per check, its day: "24 Oct". */
  labels: readonly string[];
  /**
   * Each check's time, "02:39", where checks share a day (else null): drawn on a second line under
   * its day, so a label never runs into the next one on a narrow axis.
   */
  times?: readonly (string | null)[];
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
  /**
   * On a phone the chart fits its card instead of scrolling: its axis lettering drawn larger, and
   * the note and the marker's words shown in a list under it; their copies on the lines are made
   * transparent there, never removed (owner ruling 2026-11-08).
   */
  fitOnPhone?: boolean;
}

const W = 640;
const H = 186;
/**
 * The second axis line's offset, and the room the drawing grows by to hold it: 1.2 times the
 * phone's 15-unit lettering, so the day and its time do not touch (GradeHistory.module.css).
 */
const TIME_LINE = 18;
/** The chart's top padding, in px (GradeHistory.module.css `.chart`): its box is this plus the drawing. */
const PAD_TOP = 8;
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
  fitOnPhone = false,
  times = [],
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
  const timed = times.some((t) => t);
  const height = timed ? H + TIME_LINE : H;
  const first = (s: 0 | 1) => series[s].values.find((v): v is number => v !== null);
  const marked = marker ? series[marker.series].values[marker.index] : null;
  const captionId = useId();

  return (
    <div className={fitOnPhone ? `${styles.history} ${styles.fit}` : styles.history}>
      <ScrollRegion label={label} className={styles.scroll} startAtEnd describedBy={captionId}>
        <svg
          className={styles.chart}
          data-v2-chart=""
          viewBox={`0 0 ${W} ${height}`}
          // The box grows with the drawing, so a desktop chart with times keeps its lettering's size.
          style={{ '--v2-chart-h': `${height + PAD_TOP}px` } as CSSProperties}
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
                {timed ? (
                  <>
                    <tspan x={xs[i]}>{l}</tspan>
                    <tspan x={xs[i]} dy={TIME_LINE}>
                      {times[i] ?? ''}
                    </tspan>
                  </>
                ) : (
                  l
                )}
              </text>
            ))}
          </g>
        </svg>
      </ScrollRegion>
      {fitOnPhone && ((note && first(note.series) !== undefined) || (marker && marked != null)) ? (
        // The words the drawing writes on its lines, under it on a phone; read once, in the caption.
        <ul className={styles.phoneNotes} aria-hidden="true" data-v2-addition="">
          {note && first(note.series) !== undefined ? <li>{note.text}</li> : null}
          {marker && marked != null ? (
            // The marker's words may say "blocked": the verdicts they rest on go with them (FACTS I2).
            <li data-v2-verdicts={(marker.verdicts ?? []).join(' ')}>
              <span className={styles.phoneMarker} />
              {marker.text}
            </li>
          ) : null}
        </ul>
      ) : null}
      {/* A table ignores a 1px width; the box around it holds the screen-reader-only size. */}
      <div className={layout.srOnly} data-v2-sr-only="">
        <table className={styles.values}>
          {/* Everything the drawing writes on itself, besides its axis, is read here too. */}
          <caption id={captionId}>
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

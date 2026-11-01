import type { ReactNode } from 'react';
import { Button } from '../../Button';
import { Card } from '../../Card';
import { CoverageLine, type Coverage } from '../../CoverageLine';
import { Heading } from '../../Heading';
import { StatusPill, type PillState } from '../../StatusPill';
import type {
  OpenFixView,
  RecommendationView,
  SectionFixesView,
} from '../../../../lib/v2/view/segment/fixes';
import { CopyText } from './CopyText';
import layout from '../../layout.module.css';
import styles from './SegmentScreen.module.css';

export interface Tile {
  label: string;
  value: string;
  note: string | null;
}

/**
 * The verdict card at the top of a segment: the headline, its pill, the sentence that explains it,
 * the tiles, and what the figures rest on (the coverage line, or what was read instead).
 */
export function VerdictCard({
  title,
  pill,
  body,
  tiles,
  coverage,
}: {
  title: string;
  pill: { state: PillState; label: string } | null;
  body: ReactNode;
  tiles: Tile[];
  coverage: { pages: Coverage } | { read: string };
}) {
  return (
    <section>
      <Card className={styles.verdict}>
        <div className={`${layout.row} ${styles.verdictHead}`}>
          <Heading level={1} size="m">
            {title}
          </Heading>
          {pill ? <StatusPill state={pill.state}>{pill.label}</StatusPill> : null}
        </div>
        <p className={styles.lede}>{body}</p>
        <div className={`${layout.row} ${styles.tiles}`}>
          {tiles.map((t) => (
            <div key={t.label}>
              <div className={styles.tileLabel}>{t.label}</div>
              <div className={styles.tileValue}>{t.value}</div>
              {t.note ? (
                <div className={styles.tileNote} data-v2-addition="">
                  {t.note}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div className={styles.coverage} data-v2-addition="">
          {'pages' in coverage ? (
            <CoverageLine {...coverage.pages} />
          ) : (
            <p className={`${styles.small} ${styles.muted}`} data-v2-coverage="">
              {coverage.read}
            </p>
          )}
        </div>
      </Card>
    </section>
  );
}

/**
 * A raw response or excerpt, in the data face, named for assistive technology. The name sits on a
 * figure: a bare <pre> may not carry one.
 */
export function RawBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className={styles.rawFigure} aria-label={label}>
      <pre className={styles.raw}>{children}</pre>
    </figure>
  );
}

/** A fix's recommendation class, beside it, as the evidence class sits beside a verdict. */
export function RecommendationTag({ r }: { r: RecommendationView }) {
  return (
    <span className={styles.cls} data-v2-addition="" data-v2-recommendation={r.cls}>
      {r.label}
    </span>
  );
}

function OpenFix({ f, primary, ask }: { f: OpenFixView; primary: boolean; ask: string }) {
  return (
    <div className={styles.openFix}>
      <div className={`${layout.row} ${styles.openFixHead}`}>
        <span className={`${layout.row} ${styles.effect}`}>
          <strong className={styles.openFixTitle}>{f.title}</strong>
          <RecommendationTag r={f.recommendation} />
        </span>
        <span className={`${layout.row} ${styles.effect}`}>
          <span className={styles.effectPoints}>{f.points}</span> {f.unit}
          {f.effort ? ` · ${f.effort}` : ''}
        </span>
      </div>
      {f.paragraph.map((p) => (
        <p key={p} className={styles.fixPara}>
          {p}
        </p>
      ))}
      <div className={styles.packetGrid}>
        <pre className={styles.packet}>{f.packet}</pre>
        <div className={styles.handoffCol}>
          <div className={styles.handoff}>{f.handoff}</div>
          <div className={`${layout.row} ${styles.packetActions}`}>
            <CopyText text={f.prompt} variant={primary ? 'primary' : 'default'} size="md">
              Copy as a prompt for your coding tool
            </CopyText>
            <Button variant="quiet" size="sm" href={ask}>
              Email this fix to my developer
            </Button>
            <Button variant="quiet" size="sm" href={ask}>
              Mark done and re-check now, about 2 minutes
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A section's fixes: its open ones in full, with the packet, and the rest as Pro rows. The first
 * open fix's copy button is the page's orange element (FACTS orange convention).
 */
export function SectionFixes({
  heading,
  fixes,
  note,
  footnote,
  ask,
}: {
  heading: string;
  fixes: SectionFixesView;
  /** Where an ask that needs an account goes (SegmentFrame.keepHref). */
  ask: string;
  /** Said above the fixes: why none is open here, or what the free ones are. */
  note?: ReactNode;
  /** Said under the fixes, where a locked page puts its note there. */
  footnote?: ReactNode;
}) {
  return (
    <Card as="section" className={styles.panel}>
      <div className={`${layout.row} ${styles.hd}`}>
        <Heading level={2} size="s">
          {heading}
        </Heading>
        <span className={styles.fixesCount}>{fixes.summary}</span>
      </div>
      {note ? <div className={styles.fixNote}>{note}</div> : null}
      {fixes.open.map((f, i) => (
        <OpenFix key={f.id} f={f} primary={i === 0} ask={ask} />
      ))}
      {fixes.pro.map((p) => (
        <div key={p.key} className={`${layout.row} ${styles.proRow}`}>
          <div>
            <strong>{p.title}</strong>{' '}
            <span className={layout.mut}>
              {p.scope ? `· ${p.scope} ` : ''}· {p.points}
            </span>{' '}
            {p.recommendation ? <RecommendationTag r={p.recommendation} /> : null}
          </div>
          <Button size="sm" href={ask}>
            See this fix with Pro
          </Button>
        </div>
      ))}
      {footnote ? <div className={`${styles.fixNote} ${styles.fixFoot}`}>{footnote}</div> : null}
    </Card>
  );
}

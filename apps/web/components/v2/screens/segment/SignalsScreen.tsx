import { Button } from '../../Button';
import { Card } from '../../Card';
import { Heading } from '../../Heading';
import { StatusPill } from '../../StatusPill';
import { Table } from '../../Table';
import type { SignalsView } from '../../../../lib/v2/view/segment/signals';
import { numberWord } from '../../../../lib/v2/words';
import { RecommendationTag, VerdictCard } from './SegmentParts';
import { SegmentShell } from './SegmentShell';
import layout from '../../layout.module.css';
import styles from './SegmentScreen.module.css';
import own from './SignalsScreen.module.css';

/**
 * Agent-readiness signals (Final-Seg-Signals): the verdict, the seven signals with what the check
 * found and what each is worth, and, when the audit named one, a competitor held for Pro.
 */
export function SignalsScreen({ data }: { data: SignalsView }) {
  const { frame, competitor } = data;
  return (
    <SegmentShell frame={frame} keep={data.keep} nextPrimary>
      <VerdictCard
        title={data.headline.title}
        pill={data.headline.pill}
        body={data.body}
        tiles={data.tiles}
        coverage={data.coverage}
      />
      <Card as="section" className={styles.panel}>
        <div className={`${layout.row} ${styles.hd}`}>
          <div>
            <Heading level={2} size="s">
              The {numberWord(data.rows.length)} signals, what each does, and whether it has a
              measured effect
            </Heading>
            <div className={styles.sub}>
              &quot;Measured lift&quot; means we have seen the signal change how a named engine or
              agent treats a site in our own crawls. Honest answer for most: not yet.
            </div>
          </div>
        </div>
        <Table
          label="Agent-readiness signals"
          columns={[
            { header: 'Signal' },
            { header: 'Status', hideOnPhone: true },
            { header: 'Our advice' },
            { header: 'Measured lift', hideOnPhone: true },
            { header: 'Who reads it', hideOnPhone: true },
            { header: 'Where we looked', hideOnPhone: true },
          ]}
          rows={data.rows.map((r) => ({
            key: r.signal,
            cells: [
              <>
                {r.name}
                {/* On a phone the status moves under the name, as the locked page does it. */}
                <div className={own.phoneOnly}>
                  <StatusPill state={r.status.state}>{r.status.label}</StatusPill>
                </div>
                <div data-v2-addition="">
                  {r.weight ? <div className={own.weight}>{r.weight}</div> : null}
                  <div className={own.tag}>
                    <RecommendationTag r={r.recommendation} />
                  </div>
                </div>
              </>,
              <StatusPill key="s" state={r.status.state}>
                {r.status.label}
              </StatusPill>,
              <>
                {r.advice}
                <div className={`${own.phoneOnly} ${own.weight}`}>Measured lift: {r.lift}</div>
                {/* The two columns a phone hides, kept as lines so no fact is lost (WCAG 1.4.10). */}
                <div className={`${own.phoneOnly} ${own.weight}`} data-v2-addition="">
                  Who reads it: {r.readers}
                </div>
                <div className={`${own.phoneOnly} ${own.weight}`} data-v2-addition="">
                  Where we looked: <span className={own.where}>{r.where}</span>
                </div>
              </>,
              r.lift,
              r.readers,
              <span key="w" className={own.where}>
                {r.where}
              </span>,
            ],
          }))}
        />
      </Card>
      {competitor ? (
        <Card as="section" className={styles.panel}>
          <div className={`${layout.row} ${styles.hd}`}>
            <div>
              <Heading level={2} size="s">
                How {competitor.host} compares
              </Heading>
              <div className={styles.sub}>
                {competitor.host} was named in the audit form and audited the same way from its
                public pages. One competitor per site on Pro; three on Agency.
              </div>
            </div>
            <Button size="sm" href={frame.keepHref}>
              Compare with Pro
            </Button>
          </div>
          <Table
            label="Competitor comparison, preview"
            columns={[
              { header: 'Measure' },
              { header: frame.domain, numeric: true, mono: true },
              { header: competitor.host, numeric: true, mono: true },
            ]}
            rows={competitor.rows.map((r) => ({
              key: r.measure,
              cells: [
                r.measure,
                r.own,
                r.pro ? <span className={layout.mut}>{r.theirs}</span> : r.theirs,
              ],
            }))}
          />
          {competitor.verdict ? <div className={own.foot}>{competitor.verdict}</div> : null}
        </Card>
      ) : null}
    </SegmentShell>
  );
}

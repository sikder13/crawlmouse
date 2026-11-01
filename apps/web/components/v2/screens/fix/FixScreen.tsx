import { Button } from '../../Button';
import { Card } from '../../Card';
import { Heading } from '../../Heading';
import type { FixView } from '../../../../lib/v2/view/fix';
import { ResultShell } from '../result/ResultScreen';
import { KeepBar } from '../result/KeepBar';
import { PacketActions } from '../segment/PacketActions';
import { RecommendationTag } from '../segment/SegmentParts';
import { SegmentTabs } from '../segment/SegmentTabs';
import { DownloadText } from './DownloadText';
import { FrameworkSwitch } from './FrameworkSwitch';
import layout from '../../layout.module.css';
import segment from '../segment/SegmentScreen.module.css';
import styles from './FixScreen.module.css';

/** The packet card of an open fix: the stack it is written for, the packet, and what to do with it. */
function PacketCard({ data }: { data: Extract<FixView, { kind: 'open' }> }) {
  const p = data.packet;
  return (
    <Card as="section" className={segment.panel}>
      <div className={styles.hd}>
        <Heading level={2} size="s">
          The packet
        </Heading>
        <div className={styles.hdSub}>
          {p
            ? p.stack
            : 'No packet was written for this fix. The audit names it, and its effect, above.'}
        </div>
      </div>
      {p ? (
        <>
          <pre className={styles.packet}>{p.block}</pre>
          <PacketActions
            prompt={p.prompt}
            primary
            ask={data.frame.keepHref}
            className={styles.actions}
          >
            <DownloadText text={p.prompt} filename={p.download}>
              Download as .md
            </DownloadText>
          </PacketActions>
        </>
      ) : null}
    </Card>
  );
}

/** Where a locked fix's packet would be: what it holds, and the one ask that opens it. */
function WallCard({
  data,
  primary,
}: {
  data: Extract<FixView, { kind: 'locked' }>;
  primary: boolean;
}) {
  return (
    <Card as="section" className={segment.panel}>
      <div className={styles.hd}>
        <Heading level={2} size="s">
          {data.wall.heading}
        </Heading>
        <div className={styles.hdSub}>{data.wall.body}</div>
      </div>
      <div className={`${layout.row} ${styles.actions}`}>
        <Button variant={primary ? 'primary' : 'default'} href={data.wall.action.href}>
          {data.wall.action.label}
        </Button>
      </div>
    </Card>
  );
}

/**
 * The fix page (Final-Fix): the fix's verdict and estimated effect, then, as the plan allows, its
 * packet or the ask that opens it, the before and after, and the keep bar.
 */
export function FixScreen({ data }: { data: FixView }) {
  const { frame, head } = data;
  const copies = data.kind === 'open' && data.packet !== null;
  const keepPrimary = Boolean(data.keep?.primary);
  const nextPrimary = !copies && !keepPrimary && data.kind === 'open' && frame.next !== null;
  return (
    <ResultShell share={{ keptUntil: frame.keptUntil }} rerun mainClassName={segment.main}>
      <div className={`${layout.row} ${segment.crumbRow}`}>
        <div className={`${layout.row} ${segment.crumb}`}>
          <a href={frame.overview}>{frame.domain}</a>
          <span className={layout.mut}>/</span>
          <a href={frame.section.href}>{frame.section.title}</a>
          <span className={layout.mut}>/</span>
          <span>{frame.position}</span>
          {frame.keptUntil ? (
            <span className={layout.mut}>· kept until {frame.keptUntil}</span>
          ) : null}
        </div>
        <SegmentTabs tabs={frame.tabs} />
      </div>

      <Card as="section" className={segment.verdict}>
        <div className={`${layout.row} ${styles.head}`}>
          <Heading level={1} size="m">
            {head.title}
          </Heading>
          <span className={`${layout.row} ${styles.effect}`}>
            <span className={styles.points}>{head.points}</span>
            {head.unit}
            <RecommendationTag r={head.recommendation} />
          </span>
        </div>
        {data.kind === 'resolved' ? (
          <p className={styles.lede} data-v2-addition="">
            {data.resolved}
          </p>
        ) : null}
        {head.lede.map((l) => (
          <p key={l} className={styles.lede}>
            {l}
          </p>
        ))}
        {head.tiles.length ? (
          <div className={`${layout.row} ${segment.tiles}`}>
            {head.tiles.map((t) => (
              <div key={t.label}>
                <div className={segment.tileLabel}>{t.label}</div>
                <div className={segment.tileValue}>{t.value}</div>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      {data.kind === 'resolved' ? null : (
        <section className={styles.grid}>
          {data.kind === 'open' ? (
            <PacketCard data={data} />
          ) : (
            <WallCard data={data} primary={!keepPrimary} />
          )}
          <div className={styles.side}>
            {data.beforeAfter ? (
              <Card as="section" className={styles.card}>
                <Heading level={2} size="s">
                  Before and after, one page
                </Heading>
                <table aria-label="Before and after" className={styles.table}>
                  <thead>
                    <tr>
                      <th>
                        <span className={layout.srOnly} data-v2-sr-only="">
                          Measure
                        </span>
                      </th>
                      <th className={styles.num}>Today</th>
                      <th className={styles.num}>After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.beforeAfter.rows.map((r) => (
                      <tr key={r.label}>
                        <th scope="row">{r.label}</th>
                        <td className={`${styles.num} ${styles.mono}`}>{r.today}</td>
                        <td className={`${styles.num} ${styles.mono}`}>{r.after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.beforeAfter.footnote ? (
                  <div className={styles.footnote}>{data.beforeAfter.footnote}</div>
                ) : null}
              </Card>
            ) : null}
            {data.kind === 'open' ? (
              <Card as="section" className={styles.card}>
                <Heading level={2} size="s">
                  {data.shipped.heading}
                </Heading>
                <p className={styles.body}>{data.shipped.body}</p>
                <Button href={data.shipped.action.href} className={styles.cardAction}>
                  {data.shipped.action.label}
                </Button>
              </Card>
            ) : null}
            {data.kind === 'open' && data.switcher ? (
              <Card as="section" className={styles.card}>
                <Heading level={2} size="s">
                  {data.switcher.heading}
                </Heading>
                {data.switcher.detected ? (
                  <p className={styles.body}>{data.switcher.detected}</p>
                ) : null}
                <FrameworkSwitch options={data.switcher.options} />
              </Card>
            ) : null}
          </div>
        </section>
      )}

      {data.keep && frame.keptUntil ? (
        <KeepBar domain={frame.domain} expires={frame.keptUntil} inline={data.keep} />
      ) : null}
      <div className={`${layout.row} ${segment.nav}`}>
        <Button variant="quiet" href={frame.back.href}>
          {frame.back.label}
        </Button>
        {frame.next ? (
          <Button variant={nextPrimary ? 'primary' : 'default'} href={frame.next.href}>
            {frame.next.label}
          </Button>
        ) : null}
      </div>
    </ResultShell>
  );
}

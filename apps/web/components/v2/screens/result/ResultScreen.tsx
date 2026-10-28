import { Button } from '../../Button';
import { Card } from '../../Card';
import { CoverageLine } from '../../CoverageLine';
import { Grade } from '../../Grade';
import { Heading } from '../../Heading';
import { PageShell } from '../../PageShell';
import { StatusPill } from '../../StatusPill';
import { Table } from '../../Table';
import { VerdictCell } from '../../VerdictCell';
import { LOG_IN } from '../../footer-links';
import { MapSvg } from '../../map/MapSvg';
import type { DoorView, GradeView, ResultView } from '../../../../lib/v2/view/result';
import { capitalise, count, numberWord, plural } from '../../../../lib/v2/words';
import { KeepBar } from './KeepBar';
import layout from '../../layout.module.css';
import styles from './ResultScreen.module.css';

/** How long a link to an audit nobody has kept lasts: as long as the audit, to its expiry. */
const shareNote = (keptUntil: string | null) =>
  keptUntil === null ? undefined : `The link lasts as long as this audit: until ${keptUntil}`;

/**
 * The Result page's frame. Its header offers what the state can do: `share` a finished result,
 * `rerun` a finished, failed or expired audit. Logging in is always offered.
 */
export function ResultShell({
  children,
  keep,
  share,
  rerun = false,
}: {
  children: React.ReactNode;
  keep?: React.ReactNode;
  /** Offer to share the result; `keptUntil` is null once it is kept. */
  share?: { keptUntil: string | null };
  rerun?: boolean;
}) {
  return (
    <PageShell
      header="app"
      actions={
        <>
          {share ? (
            <Button variant="quiet" size="sm" href="#" title={shareNote(share.keptUntil)}>
              Share
            </Button>
          ) : null}
          {rerun ? (
            <Button variant="quiet" size="sm" href="#">
              Re-run, free
            </Button>
          ) : null}
          <Button variant="quiet" size="sm" href={LOG_IN.href}>
            {LOG_IN.label}
          </Button>
        </>
      }
    >
      <main className={`${layout.wrap} ${styles.main}`}>{children}</main>
      {keep}
    </PageShell>
  );
}

function GradeCard({ g }: { g: GradeView }) {
  return (
    <Card className={styles.gradeCard}>
      {g.withheld ? (
        <Grade label={g.label} withheld size="lg">
          {g.summary}
        </Grade>
      ) : (
        <Grade label={g.label} letter={g.letter!} score={g.score!} tone={g.tone} size="lg">
          {g.summary}
        </Grade>
      )}
    </Card>
  );
}

/**
 * The Result screen (Final-Result, Final-Result-Dark) for a finished check: the bad site as
 * locked, the clean bill, or a check whose AI readability is withheld. Every number and every
 * sentence about the site comes from `resultView`.
 */
export function ResultScreen({ data }: { data: ResultView }) {
  const { grades, first, doors, fixes, map, crawlers } = data;
  const kept = data.keptUntil === null;

  return (
    <ResultShell
      keep={kept ? null : <KeepBar domain={data.domain} expires={data.keptUntil!} />}
      share={{ keptUntil: data.keptUntil }}
      rerun
    >
      <section>
        <div>
          <Heading level={1} size="m">
            {data.domain}
          </Heading>
          <div className={`${layout.mut} ${styles.meta}`}>
            {data.crawledLine} · {data.crawledAt}
            {kept ? '' : ` · this result and its share link are kept until ${data.keptUntil}`}
          </div>
        </div>
        <div className={styles.g31}>
          {grades.map((g) => (
            <GradeCard key={g.label} g={g} />
          ))}
          {first.kind === 'fix' ? (
            <Card tone="sunken" className={`${styles.gradeCard} ${styles.fixFirst}`}>
              <div>
                <div className={`${layout.mut} ${styles.small}`}>If you fix one thing today</div>
                <div className={styles.fixFirstTitle}>{first.title}</div>
                <div className={styles.fixFirstBody}>{first.body}</div>
              </div>
              <div className={`${layout.row} ${styles.actions}`}>
                <Button variant="primary" href={first.href}>
                  Open the fix
                </Button>
                <Button variant="quiet" size="sm" href="#" title={shareNote(data.keptUntil)}>
                  Email this fix to my developer
                </Button>
              </div>
            </Card>
          ) : (
            <Card tone="sunken" className={`${styles.gradeCard} ${styles.fixFirst}`}>
              <div>
                <div className={`${layout.mut} ${styles.small}`}>Nothing to fix today</div>
                <div className={styles.fixFirstTitle}>Keep it that way</div>
                <div className={styles.fixFirstBody}>{first.body}</div>
              </div>
              {first.action ? (
                <div className={`${layout.row} ${styles.actions}`}>
                  <Button variant="primary" href={first.action.href}>
                    {first.action.label}
                  </Button>
                </div>
              ) : null}
            </Card>
          )}
        </div>
      </section>

      <section>
        <div className={`${layout.row} ${styles.sectionHead}`}>
          <Heading level={2} size="s">
            Everything we checked
          </Heading>
          <span className={`${layout.mut} ${styles.small}`}>
            Open any section for the full table, the evidence and the fixes.
          </span>
        </div>
        <div className={styles.g3}>
          {doors.map((d) => (
            <Door key={d.title} door={d} kept={kept} />
          ))}
        </div>
      </section>

      {crawlers ? (
        <div data-v2-addition="">
          <Card as="section" className={styles.crawlers}>
            <Table
              label="What each crawler got back"
              heading={
                <div className={`${layout.row} ${styles.fixesHead}`}>
                  <Heading level={2} size="s">
                    What each crawler got back
                  </Heading>
                </div>
              }
              columns={[
                { header: 'Crawler' },
                { header: 'Counts towards', muted: true },
                { header: 'Verdict' },
                { header: 'Status', numeric: true, mono: true },
                { header: 'Text it can read', numeric: true, mono: true },
              ]}
              rows={crawlers.map((c) => ({
                key: c.ua,
                cells: [
                  c.ua,
                  c.group,
                  <VerdictCell key="v" verdict={c.verdict} evidence={c.evidence} />,
                  c.status,
                  c.text,
                ],
              }))}
            />
          </Card>
        </div>
      ) : null}

      {fixes ? (
        <Card as="section" className={kept ? `${styles.fixes} ${styles.fixesAlone}` : styles.fixes}>
          <Table
            label={`${capitalise(numberWord(fixes.total))} ${plural(fixes.total, 'fix', 'fixes')}, in order of impact`}
            heading={
              <div className={`${layout.row} ${styles.fixesHead}`}>
                <Heading level={2} size="s">
                  {capitalise(numberWord(fixes.total))} {plural(fixes.total, 'fix', 'fixes')}, in
                  order of impact
                </Heading>
                <StatusPill state="ok">{fixes.open} open now</StatusPill>
                {fixes.pro ? <StatusPill state="neutral">{fixes.pro} on Pro</StatusPill> : null}
              </div>
            }
            columns={[
              { header: 'Fix' },
              { header: 'Points', numeric: true, mono: true },
              { header: 'Open', numeric: true },
            ]}
            rows={fixes.rows.map((f) => ({
              key: f.key,
              muted: !f.open,
              cells: [
                f.open ? (
                  <>
                    <strong>{f.title}</strong>
                    {f.scope ? <span className={layout.mut}> · {f.scope}</span> : null}
                  </>
                ) : (
                  f.title
                ),
                f.open ? <span className={styles.gain}>{f.points}</span> : f.points,
                f.open ? (
                  <Button variant="quiet" size="sm" href={f.href}>
                    Open
                  </Button>
                ) : (
                  <Button variant="quiet" size="sm" href={f.href} className={styles.mutedButton}>
                    See with Pro
                  </Button>
                ),
              ],
            }))}
          />
          {kept ? null : (
            <div id="pro" className={styles.pro}>
              <Heading level={2} size="s" className={styles.proTitle}>
                All {numberWord(fixes.total)}, and this site checked every week.
              </Heading>
              <p className={styles.proBody}>
                Pro re-runs the audit weekly, tells you when a crawler is blocked or a template
                breaks, and compares you with one competitor. Keeping this audit starts 14 days of
                it; nothing you can see is deleted after.
              </p>
              <p className={`${layout.mut} ${styles.proNote}`}>
                Agencies: 25 client sites and reports under your own brand, $69 a month.
              </p>
              <div className={`${layout.row} ${styles.actions} ${styles.proActions}`}>
                <Button href="#keep">Keep this audit, start 14 days of Pro</Button>
                <Button variant="quiet" size="sm" href="#">
                  What Pro includes
                </Button>
              </div>
            </div>
          )}
        </Card>
      ) : (
        <div data-v2-addition="">
          <Card as="section" tone="sunken" className={styles.competitor}>
            <Heading level={2} size="s" className={styles.proTitle}>
              Is a competitor this readable?
            </Heading>
            <p className={styles.proBody}>
              Pro checks one competitor per site the same way, every week: which crawlers get in,
              how much text arrives without JavaScript, and both grades side by side. Keeping this
              audit starts 14 days of it; nothing you can see is deleted after.
            </p>
            <div className={`${layout.row} ${styles.actions}`}>
              <Button href="#keep">Keep this audit, start 14 days of Pro</Button>
            </div>
          </Card>
        </div>
      )}

      <Card href="#" className={styles.mapDoor}>
        <div className={styles.mapThumb}>
          <MapSvg
            nodes={map.nodes}
            positions={map.positions}
            fit="slice"
            className={styles.mapSvg}
          />
        </div>
        <div className={styles.mapText}>
          <strong className={styles.doorTitle}>Explore the link map</strong>
          <div className={`${layout.mut} ${styles.small} ${styles.mapSummary}`}>
            {count(map.pages)} {plural(map.pages, 'page', 'pages')}, {count(map.links)}{' '}
            {plural(map.links, 'link', 'links')}, {count(map.orphans)}{' '}
            {plural(map.orphans, 'orphan', 'orphans')}. Select any page to see what links to it,
            what it links to, and which crawlers can reach it.
          </div>
        </div>
        <div className={styles.mapOpen}>
          <Button presentational size="sm">
            Open
          </Button>
        </div>
      </Card>
    </ResultShell>
  );
}

const BAR_TONE = { bad: 'barBad', warn: 'barWarn', neutral: 'barNeutral' } as const;

function Door({ door: d, kept }: { door: DoorView; kept: boolean }) {
  return (
    <Card href={d.href} className={`${styles.door} ${d.keep && !kept ? styles.doorKeep : ''}`}>
      <div className={`${layout.row} ${styles.doorHead}`}>
        <strong className={styles.doorTitle}>{d.title}</strong>
        <StatusPill state={d.pill.state}>{d.pill.label}</StatusPill>
      </div>
      {d.bar ? (
        <div className={styles.doorBar}>
          <div
            className={styles[BAR_TONE[d.bar.tone]]}
            style={{ width: `${Math.max(0, Math.min(100, d.bar.percent))}%` }}
          />
        </div>
      ) : null}
      <div className={styles.doorBody}>{d.body}</div>
      <div data-v2-addition="">
        {'pages' in d.coverage ? (
          <CoverageLine {...d.coverage.pages} />
        ) : (
          <p className={styles.coverageRead} data-v2-coverage="">
            {d.coverage.read}
          </p>
        )}
      </div>
      <div className={`${layout.mut} ${styles.doorFoot}`}>{d.footer}</div>
    </Card>
  );
}

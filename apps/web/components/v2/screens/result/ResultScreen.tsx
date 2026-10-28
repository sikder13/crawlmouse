import { Button } from '../../Button';
import { Card } from '../../Card';
import { Grade } from '../../Grade';
import { Heading } from '../../Heading';
import { PageShell } from '../../PageShell';
import { StatusPill } from '../../StatusPill';
import { Table } from '../../Table';
import { LinkMapGraph } from '../../graph/LinkMapGraph';
import { capitalise, count, numberWord, plural } from '../words';
import type { ResultDoor, ResultScreenData } from '../types';
import { KeepBar } from './KeepBar';
import layout from '../../layout.module.css';
import styles from './ResultScreen.module.css';

const SHARE_NOTE = 'The link lasts as long as this audit, 24 hours';

/**
 * The fix counts the headline and the two pills state, from the rows. Throws when they do not
 * reconcile with the total: counts must agree on every surface (design lock §3).
 */
export function fixCounts({ total, rows }: ResultScreenData['fixes']) {
  const open = rows.filter((r) => r.open).reduce((n, r) => n + r.count, 0);
  const pro = rows.filter((r) => !r.open).reduce((n, r) => n + r.count, 0);
  if (open + pro !== total) {
    throw new Error(`The fixes rows add up to ${open + pro}, but the total is ${total}`);
  }
  return { open, pro };
}

/** "All 214 pages crawled", or "200 of 214 pages crawled" when the crawl stopped short. */
function crawledLine({ pagesCrawled, pagesTotal }: ResultScreenData['crawl']) {
  return pagesCrawled === pagesTotal
    ? `All ${count(pagesTotal)} ${plural(pagesTotal, 'page', 'pages')} crawled`
    : `${count(pagesCrawled)} of ${count(pagesTotal)} pages crawled`;
}

/** The locked Result screen (Final-Result and Final-Result-Dark), built from the v2 primitives. */
export function ResultScreen({ data }: { data: ResultScreenData }) {
  const { crawl, grades, fixFirst, doors, fixes, map } = data;
  const { open, pro } = fixCounts(fixes);

  return (
    <PageShell
      header="app"
      footer={false}
      actions={
        <>
          <Button variant="quiet" size="sm" href="#" title={SHARE_NOTE}>
            Share
          </Button>
          <Button variant="quiet" size="sm" href="#">
            Re-run, free
          </Button>
          <Button variant="quiet" size="sm" href="#">
            Log in
          </Button>
        </>
      }
    >
      <main className={`${layout.wrap} ${styles.main}`}>
        <section>
          <div>
            <Heading level={1} size="m">
              {data.domain}
            </Heading>
            <div className={`${layout.mut} ${styles.meta}`}>
              {crawledLine(crawl)} · {crawl.crawledAt} · this result and its share link are kept
              until {crawl.keptUntil}
            </div>
          </div>
          <div className={styles.g31}>
            {grades.map((g) => (
              <Card key={g.label} className={styles.gradeCard}>
                <Grade label={g.label} letter={g.letter} score={g.score} tone={g.tone} size="lg">
                  {g.summary}
                </Grade>
              </Card>
            ))}
            <Card tone="sunken" className={`${styles.gradeCard} ${styles.fixFirst}`}>
              <div>
                <div className={`${layout.mut} ${styles.small}`}>If you fix one thing today</div>
                <div className={styles.fixFirstTitle}>{fixFirst.title}</div>
                <div className={styles.fixFirstBody}>{fixFirst.body}</div>
              </div>
              <div className={`${layout.row} ${styles.actions}`}>
                <Button variant="primary" href={fixFirst.href}>
                  Open the fix
                </Button>
                <Button variant="quiet" size="sm" href="#" title={SHARE_NOTE}>
                  Email this fix to my developer
                </Button>
              </div>
            </Card>
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
              <Door key={d.title} door={d} />
            ))}
          </div>
        </section>

        <Card as="section" className={styles.fixes}>
          <Table
            label={`${capitalise(numberWord(fixes.total))} fixes, in order of impact`}
            heading={
              <div className={`${layout.row} ${styles.fixesHead}`}>
                <Heading level={2} size="s">
                  {capitalise(numberWord(fixes.total))} fixes, in order of impact
                </Heading>
                <StatusPill state="ok">{open} open now</StatusPill>
                <StatusPill state="neutral">{pro} on Pro</StatusPill>
              </div>
            }
            columns={[
              { header: 'Fix' },
              { header: 'Points', numeric: true, mono: true },
              { header: 'Open', numeric: true },
            ]}
            rows={fixes.rows.map((f) => ({
              key: f.title,
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
          <div id="pro" className={styles.pro}>
            <Heading level={2} size="s" className={styles.proTitle}>
              All {numberWord(fixes.total)}, and this site checked every week.
            </Heading>
            <p className={styles.proBody}>
              Pro re-runs the audit weekly, tells you when a crawler is blocked or a template
              breaks, and compares you with one competitor. Keeping this audit starts 14 days of it;
              nothing is deleted after.
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
        </Card>

        <Card href={map.href} className={styles.mapDoor}>
          <div className={styles.mapThumb}>
            <LinkMapGraph variant="thumb" className={styles.mapSvg} />
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
      </main>
      <KeepBar domain={data.domain} expires={crawl.keptUntil} />
    </PageShell>
  );
}

const BAR_TONE = { bad: 'barBad', warn: 'barWarn', neutral: 'barNeutral' } as const;

function Door({ door: d }: { door: ResultDoor }) {
  return (
    <Card href={d.href} className={`${styles.door} ${d.keep ? styles.doorKeep : ''}`}>
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
      <div className={`${layout.mut} ${styles.doorFoot}`}>{d.footer}</div>
    </Card>
  );
}

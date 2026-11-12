import { Button } from '../../Button';
import { Card } from '../../Card';
import { Grade } from '../../Grade';
import { Heading } from '../../Heading';
import { PageShell } from '../../PageShell';
import { StatusPill } from '../../StatusPill';
import { Table } from '../../Table';
import { VERDICTS } from '../../verdicts';
import { LOG_IN, MARKETING_NAV } from '../../footer-links';
import type { PublicReportView } from '../../../../lib/v2/view/public-report';
import { AuditForm } from '../home/AuditForm';
import layout from '../../layout.module.css';
import styles from './PublicReportScreen.module.css';

/**
 * The shared report (Final-Public, FACTS Part 2), read-only, from `publicReportView`. It shows the
 * grades, what each crawler got back and the titles of the fixes Free opens; it holds no fix packet,
 * evidence or link: those are in the full audit. The audit form at its foot is the one orange
 * element. The artboard's "this link works until…" belongs to share links (CC-31), not to a minted
 * report, so it is not shown.
 */
export function PublicReportScreen({
  view,
  start = false,
}: {
  view: PublicReportView;
  /** The form starts an audit (`POST /api/checks`); omitted (the preview), it posts nowhere. */
  start?: boolean;
}) {
  const { fixes } = view;
  return (
    <PageShell
      nav={MARKETING_NAV}
      actions={
        <Button variant="quiet" href={LOG_IN.href}>
          {LOG_IN.label}
        </Button>
      }
    >
      <main className={`${layout.wrap} ${styles.main}`}>
        <div className={`${layout.row} ${styles.crumbs}`}>
          <div className={`${layout.row} ${styles.crumb}`}>
            <span className={layout.mut}>Shared audit</span>
            <span className={layout.mut} aria-hidden="true">
              /
            </span>
            <span>{view.host}</span>
            <span className={layout.mut}>· {view.checkedAt}</span>
          </div>
          <StatusPill state="neutral">read-only</StatusPill>
        </div>

        <Card as="section" className={styles.overview}>
          <Heading level={1} size="m" className={styles.headline}>
            {view.headline}
          </Heading>
          <div className={`${layout.row} ${styles.figures}`}>
            {view.grades.map((g) =>
              g.withheld ? (
                <Grade key={g.label} label={g.label} withheld>
                  {g.summary}
                </Grade>
              ) : (
                <Grade
                  key={g.label}
                  label={g.label}
                  letter={g.letter!}
                  score={g.score!}
                  tone={g.tone}
                >
                  {g.summary}
                </Grade>
              ),
            )}
            <div>
              <div className={`${layout.mut} ${styles.small}`}>Pages</div>
              <div className={styles.figure}>{view.pages}</div>
            </div>
            <div>
              <div className={`${layout.mut} ${styles.small}`}>Fixes found</div>
              <div className={styles.figure}>{view.fixesFound}</div>
            </div>
          </div>
        </Card>

        <div>
          <Card as="section" className={styles.flush}>
            <Table
              label="Crawler access"
              heading={
                <div className={styles.head}>
                  <Heading level={2} size="s">
                    What each crawler got back
                  </Heading>
                </div>
              }
              columns={[
                { header: 'Crawler' },
                { header: 'Result' },
                { header: 'Text it can read', numeric: true, mono: true },
                { header: 'Cause', muted: true },
              ]}
              rows={view.crawlers.map((c) => {
                const v = VERDICTS[c.verdict];
                return {
                  key: c.ua,
                  cells: [
                    c.ua,
                    <StatusPill key="v" state={v.state}>
                      {c.qualifier ? `${v.label} ${c.qualifier}` : v.label}
                    </StatusPill>,
                    c.text,
                    c.cause,
                  ],
                };
              })}
            />
          </Card>
          {/* FACTS D1: one line under every crawler table, without its sentence on our source IPs, which
              /bot does not list (CC-29 Q28; __tests__/v2/no-published-ips.test.ts). */}
          <p className={`${layout.mut} ${styles.tableNote}`}>
            Tested with tagged user agents — <a href="/bot">crawlmouse.com/bot</a>.
          </p>
        </div>

        {fixes ? (
          <Card as="section" className={styles.flush}>
            <Table
              label="Top fixes"
              headersHidden
              heading={
                <div className={`${layout.row} ${styles.head} ${styles.fixesHead}`}>
                  <Heading level={2} size="s">
                    {fixes.heading}
                  </Heading>
                  {fixes.more ? (
                    <span className={`${layout.mut} ${styles.small}`}>{fixes.more}</span>
                  ) : null}
                </div>
              }
              columns={[
                { header: 'Rank', mono: true, muted: true },
                { header: 'Fix' },
                { header: 'Estimated effect', numeric: true, mono: true },
              ]}
              rows={fixes.rows.map((f) => ({
                key: String(f.rank),
                cells: [
                  f.rank,
                  <>
                    {f.title}
                    {f.scope ? <span className={layout.mut}> · {f.scope}</span> : null}
                  </>,
                  f.points,
                ],
              }))}
            />
            <div className={`${layout.row} ${styles.fixesFoot}`}>
              <span className={layout.mut}>
                This shared view is the verdict. The fix packets, the evidence for every response
                and the link map are in the full audit, or you can run it yourself.
              </span>
              <Button variant="quiet" size="sm" href="#own">
                Run it yourself, free
              </Button>
            </div>
          </Card>
        ) : null}

        <Card as="section" id="own" className={`${layout.row} ${styles.own}`}>
          <div>
            <div className={styles.ownQuestion}>{view.ownQuestion}</div>
            <div className={`${layout.mut} ${styles.small}`}>
              Free, about two minutes, nothing to install. The result is kept 24 hours; one email
              keeps it longer.
            </div>
          </div>
          <AuditForm
            fieldId="url"
            label="Audit your site"
            primary
            start={start}
            className={styles.ownForm}
            inputClassName={styles.ownInput}
            buttonClassName={styles.ownButton}
          />
        </Card>
      </main>
    </PageShell>
  );
}

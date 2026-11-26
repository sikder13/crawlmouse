import { Button } from '../../Button';
import { Card } from '../../Card';
import { CheckGlyphRow } from '../../CheckGlyphRow';
import { GradeHistory } from '../../GradeHistory';
import { Glyph, StatusPill } from '../../StatusPill';
import { Fragment, type ReactNode } from 'react';
import { Table, type TableColumn } from '../../Table';
import { VERDICTS } from '../../verdicts';
import { VisuallyHidden } from '../../VisuallyHidden';
import { TAGGED_UA_LINE } from '../../../../lib/v2/copy/site';
import type { DashboardView } from '../../../../lib/v2/view/dashboard';
import { AccountFrame } from '../account/AccountFrame';
import { ActionControl } from '../account/ActionControl';
import { Notice, type NoticeView } from '../account/Notice';
import { CardHead, GradeText } from '../account/parts';
import { spokenRun, verdictCell } from '../account/verdict-cells';
import shared from '../account/AccountScreen.module.css';
import styles from './DashboardScreen.module.css';

type Props = { data: DashboardView };

/** The sites table's columns: their headers also label each cell where a phone stacks the row. */
const SITE_COLUMNS: TableColumn[] = [
  { header: 'Site', mono: true },
  { header: 'Technical SEO' },
  { header: 'AI readability' },
  { header: 'Since last crawl' },
  { header: 'Schedule', muted: true },
  { header: 'Last check', numeric: true, mono: true, muted: true },
];

/**
 * A cell's value with its column's header above it, drawn only where a phone stacks the row and the
 * header row is not drawn. Hidden from assistive technology, which reads the column header itself.
 */
function Labelled({ column, children }: { column: number; children: ReactNode }) {
  return (
    <>
      <span className={styles.cellName} aria-hidden="true" data-v2-addition="">
        {SITE_COLUMNS[column]!.header}
      </span>
      {children}
    </>
  );
}

/** "staging.example-outfitter.dev" in the pieces it may break between: after each dot. */
const hostParts = (host: string) => host.split(/(?<=\.)/);
/** "Fri 06:01 · check queued" in the pieces it may break between: after each " · ". */
const checkParts = (line: string) => line.split(/(?<= · )/);

/**
 * A part longer than this may break inside itself: a dot-free label of a host can run to 63
 * characters (a punycode `xn--…` or a long hyphenated name), more than a phone's sites table holds
 * on one line (about 40 mono characters at 390px).
 */
const LONG_PART = 24;

/**
 * Text that breaks between its parts, and inside a part only when the part is longer than
 * `LONG_PART`: "example-outfitter." stays whole, a 63-character label wraps where it must.
 */
function Breaks({ parts }: { parts: readonly string[] }) {
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 ? <wbr /> : null}
          <span
            className={p.length > LONG_PART ? styles.longPart : styles.whole}
            data-v2-part={p.length > LONG_PART ? 'long' : 'whole'}
          >
            {p}
          </span>
        </Fragment>
      ))}
    </>
  );
}

function Header({ data }: Props) {
  const { header } = data;
  return (
    <header className={shared.header}>
      <div>
        <h1 className={shared.title}>{header.title}</h1>
        <div className={shared.line}>{header.line}</div>
      </div>
      <div className={shared.actions}>
        {header.actions.map((a) => (
          <ActionControl key={a.label} action={a} size={a.primary ? 'md' : 'sm'} />
        ))}
      </div>
    </header>
  );
}

/** "Since Thursday's check": health and the change counts, each reconciled with the rows below. */
function Strip({ strip }: { strip: NonNullable<DashboardView['strip']> }) {
  const h = strip.health;
  return (
    <Card className={styles.strip}>
      <div className={styles.cell}>
        <div className={styles.cellLabel}>
          {h.seoOnly ? (
            <span data-v2-addition="">{h.seoOnly.label}</span>
          ) : (
            'Health, all sites · mean of both grades'
          )}
        </div>
        <div className={styles.cellRow}>
          <span className={styles.big} data-v2-health-value="">
            {h.seoOnly ? h.seoOnly.value : h.value}
          </span>
          {h.delta ? (
            <span className={h.deltaTone === 'bad' ? `${shared.mono} ${shared.bad}` : shared.mono}>
              {h.delta}
            </span>
          ) : null}
          {h.fresh ? (
            <span className={styles.noun} data-v2-addition="" data-v2-health-fresh="">
              {h.fresh}
            </span>
          ) : null}
        </div>
        {h.excluded ? (
          <div className={styles.excluded} data-v2-addition="">
            {h.excluded}
          </div>
        ) : null}
      </div>
      {(
        [
          ['Opened', strip.opened],
          ['Resolved', strip.resolved],
        ] as const
      ).map(([label, c]) => (
        <div key={label} className={styles.cell}>
          <div className={styles.cellLabel}>{label}</div>
          <div className={styles.cellRow}>
            <span className={styles.big}>{c.count}</span>
            {c.noun ? (
              <span className={styles.noun} data-v2-verdicts={c.verdicts.join(' ')}>
                {c.noun}
              </span>
            ) : null}
          </div>
        </div>
      ))}
      <div className={styles.cell}>
        <div className={styles.cellLabel}>Other changes</div>
        <div className={styles.cellRow}>
          <span className={styles.big}>{strip.other.count}</span>
          <a href={strip.other.show.href} className={styles.show}>
            {strip.other.show.label}
            {strip.other.show.context ? (
              <VisuallyHidden>{` ${strip.other.show.context}`}</VisuallyHidden>
            ) : null}
          </a>
        </div>
      </div>
    </Card>
  );
}

function Changed({ data }: Props) {
  return (
    <Card as="section" className={shared.panel}>
      <CardHead title="What changed, by site">
        <a href="/changes" className={shared.sub}>
          Full change log
        </a>
      </CardHead>
      <Table
        shade
        label="What changed, by site"
        headersHidden
        className={styles.changedTable}
        columns={[
          { header: 'Change' },
          { header: 'What and where' },
          { header: 'Actions', numeric: true },
        ]}
        rows={data.changed.map((c) => ({
          key: c.key,
          cells: [
            <span key="p" data-v2-verdicts={c.verdicts.join(' ')}>
              <StatusPill state={c.pill.state}>{c.pill.label}</StatusPill>
            </span>,
            <span key="t">
              <strong>{c.title}</strong>
              <div className={styles.small}>{c.line}</div>
            </span>,
            <span key="a" className={styles.rowActions}>
              {c.actions.map((a) => (
                <ActionControl key={a.label} action={a} variant="quiet" />
              ))}
            </span>,
          ],
        }))}
      />
    </Card>
  );
}

function History({ data }: Props) {
  const h = data.history!;
  const rows = data.crawlersByCheck ?? [];
  return (
    <Card as="section" className={shared.panel}>
      <CardHead title={h.title}>
        {/* A line no check gave a score for is not drawn, so the legend does not name it (D-25). */}
        {h.points.some((p) => p.seo !== null) ? (
          <span className={styles.legend}>
            <span className={styles.swatch} aria-hidden="true" />
            Technical SEO
          </span>
        ) : null}
        {h.points.some((p) => p.ai !== null) ? (
          <span className={styles.legend}>
            <span className={`${styles.swatch} ${styles.dashed}`} aria-hidden="true" />
            AI readability
          </span>
        ) : null}
      </CardHead>
      <GradeHistory
        fitOnPhone
        label={h.title}
        labels={h.points.map((p) => p.label)}
        times={h.points.map((p) => p.time)}
        dates={h.points.map((p) => p.date)}
        series={[
          { name: 'Technical SEO', values: h.points.map((p) => p.seo) },
          { name: 'AI readability', values: h.points.map((p) => p.ai), dashed: true },
        ]}
        caption={h.summary}
        note={h.flatNote ? { series: 1, text: h.flatNote } : null}
        marker={
          h.marker
            ? {
                series: 1,
                index: h.marker.index,
                text: h.marker.label,
                verdicts: h.marker.verdicts,
              }
            : null
        }
      />
      {rows.length ? (
        <div className={styles.byCheck}>
          <div className={styles.small} data-v2-verdicts={data.legend.join(' ')}>
            Crawler access by check ·{' '}
            {data.legend.map((v) => (
              <span key={v} className={styles.legendItem}>
                <Glyph state={VERDICTS[v].state} className={styles.legendGlyph} />
                {VERDICTS[v].label}
              </span>
            ))}
          </div>
          <Table
            shade
            label="Crawler access by check"
            headersHidden
            rowHeader
            className={styles.byCheckTable}
            columns={[{ header: 'Crawler' }, { header: 'Access at each check' }]}
            rows={rows.map((r) => {
              const cells = r.verdicts.map((v) => verdictCell(v, r.group));
              return {
                key: r.ua,
                cells: [r.ua, <CheckGlyphRow key="g" cells={cells} spoken={spokenRun(cells)} />],
              };
            })}
          />
          <div className={shared.note}>{TAGGED_UA_LINE}</div>
        </div>
      ) : null}
    </Card>
  );
}

function CrawlersNow({ data }: Props) {
  return (
    <Card as="section" className={shared.panel}>
      <CardHead title="Crawler access now" />
      {data.crawlersSite ? (
        // Which site the two crawler panels read (D-09): the blocks on the others are listed apart.
        <div className={shared.note} data-v2-addition="" data-v2-crawlers-site="">
          {data.crawlersSite}
        </div>
      ) : null}
      <Table
        shade
        label="Crawler access"
        headersHidden
        rowHeader
        columns={[{ header: 'Crawler' }, { header: 'Access', numeric: true }]}
        rows={(data.crawlersNow ?? []).map((r) => ({
          key: r.ua,
          cells: [
            r.ua,
            // The full verdict words (FACTS I2) in a pill that may wrap: the card is a third of the row.
            <span key="v" className={styles.nowPill} data-v2-verdict={r.verdict}>
              <StatusPill state={VERDICTS[r.verdict].state}>
                {r.qualifier
                  ? `${VERDICTS[r.verdict].label} ${r.qualifier}`
                  : VERDICTS[r.verdict].label}
              </StatusPill>
            </span>,
          ],
        }))}
      />
      <div className={shared.note}>{TAGGED_UA_LINE}</div>
    </Card>
  );
}

/** AI crawlers blocked on the sites the crawler panels do not read (D-09). */
function BlockedElsewhere({ data }: Props) {
  return (
    <Card as="section" className={shared.panel}>
      <div
        data-v2-addition=""
        data-v2-blocked-elsewhere=""
        // Every row is a blocking verdict, so the title's "blocked" is vouched for (FACTS I2).
        data-v2-verdicts={data.blockedElsewhere.map((b) => b.verdict).join(' ')}
      >
        <CardHead title={data.blockedTitle} />
        <Table
          // Like the dashboard's other tables: a shade shows only if a narrow screen overflows it.
          shade
          label={data.blockedTitle}
          headersHidden
          rowHeader={0}
          // Two columns, so the card fits a phone: the crawler and its verdict share a cell and
          // wrap onto two lines when the width runs out, and a long host breaks inside itself.
          columns={[{ header: 'Site', mono: true }, { header: 'Crawler and access' }]}
          rows={data.blockedElsewhere.map((b) => ({
            key: b.key,
            cells: [
              // The site is named, not linked: the Sites table below links each site, and a link here
              // would repeat that name for every blocked crawler of the site (account-control-names).
              <span key="h" className={styles.blockedHost}>
                {b.host}
              </span>,
              <span key="v" className={styles.blockedAccess}>
                <span>{b.ua}</span>
                <span data-v2-verdict={b.verdict}>
                  <StatusPill state={VERDICTS[b.verdict].state}>
                    {VERDICTS[b.verdict].label}
                  </StatusPill>
                </span>
              </span>,
            ],
          }))}
        />
      </div>
    </Card>
  );
}

function Sites({ data }: Props) {
  const { sites } = data;
  return (
    <Card as="section" className={shared.panel}>
      <CardHead title="Sites">
        <span className={shared.sub}>
          {sites.note}
          {sites.apart ? <span data-v2-addition="">{` · ${sites.apart}`}</span> : null}
        </span>
        {sites.upsell ? <ActionControl action={sites.upsell} /> : null}
      </CardHead>
      {sites.rows.length ? (
        <Table
          shade
          label="Watched sites"
          rowHeader
          // A phone lays each row out as a grid: the roles keep the column names read (review 7).
          roles
          className={styles.sitesTable}
          columns={SITE_COLUMNS}
          rows={sites.rows.map((r) => ({
            key: r.key,
            cells: [
              <a key="h" href={r.href}>
                <Breaks parts={hostParts(r.host)} />
              </a>,
              <Labelled key="s" column={1}>
                <GradeText grade={r.seo} />
              </Labelled>,
              <Labelled key="a" column={2}>
                <GradeText grade={r.ai} withheld={r.aiWithheld} />
              </Labelled>,
              <Labelled key="c" column={3}>
                {r.since.pills.length ? (
                  <span className={shared.pills} data-v2-verdicts={r.since.verdicts.join(' ')}>
                    {r.since.pills.map((p) => (
                      <StatusPill key={p.label} state={p.state}>
                        {p.label}
                      </StatusPill>
                    ))}
                  </span>
                ) : (
                  <span className={shared.muted}>{r.sinceLabel}</span>
                )}
              </Labelled>,
              <Labelled key="sc" column={4}>
                {r.schedule}
              </Labelled>,
              <Labelled key="l" column={5}>
                <Breaks parts={checkParts(r.lastCheck)} />
              </Labelled>,
            ],
          }))}
        />
      ) : null}
      {sites.add ? (
        // Day 0 with no site: the action beside the sentence that says what it starts.
        <div className={styles.empty} data-v2-no-site-add="">
          {sites.foot ? <p>{sites.foot}</p> : null}
          <ActionControl action={sites.add} size="md" />
        </div>
      ) : sites.foot ? (
        <div className={shared.foot}>{sites.foot}</div>
      ) : null}
      {data.earlier ? <Earlier earlier={data.earlier} /> : null}
    </Card>
  );
}

/** The viewer's own v1 audits (CC-36 D5): one quiet line that opens their list. */
function Earlier({ earlier }: { earlier: NonNullable<DashboardView['earlier']> }) {
  return (
    <details className={styles.earlier} data-v2-addition="" data-v2-earlier-audits="">
      <summary className={styles.earlierLine}>{earlier.line}</summary>
      <ul className={styles.earlierList} aria-label={earlier.label}>
        {earlier.rows.map((r) => (
          <li key={r.key}>
            <a href={r.href} className={shared.mono} aria-label={r.name}>
              {r.host}
            </a>{' '}
            <span className={shared.muted}>
              · {r.date} · {r.grade}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function TopFixes({ top }: { top: NonNullable<DashboardView['topFixes']> }) {
  return (
    <Card as="section" className={shared.panel}>
      <CardHead title={top.title} />
      <Table
        shade
        label="Top fixes"
        headersHidden
        columns={[
          { header: 'No.', mono: true, muted: true },
          { header: 'Fix' },
          { header: 'Effect', numeric: true, mono: true },
          { header: 'Open', numeric: true },
        ]}
        rows={top.rows.map((r) => ({
          key: r.key,
          cells: [
            String(r.number),
            <span key="t">
              {r.title}
              {r.effort ? (
                // Data, so it shows on a phone too, where the locked page hides it (owner ruling
                // 2026-11-08); it wraps under the title in the narrow column.
                <span className={shared.muted} data-v2-effort="">
                  {' '}
                  · {r.effort}
                </span>
              ) : null}
            </span>,
            r.effect,
            <Button key="o" href={r.open.href} variant="quiet" size="sm">
              {r.open.label}
              <VisuallyHidden>{` fix ${r.number}`}</VisuallyHidden>
            </Button>,
          ],
        }))}
      />
      <div className={shared.foot}>
        <span>{top.foot}</span>
        <ActionControl action={top.run} variant="quiet" />
      </div>
    </Card>
  );
}

/**
 * The set-up card. Its title counts the items left in the table; the weekly schedule is a link to
 * change one that is set, not a thing left (Q8), so it sits under the table and is never "not done".
 */
function Setup({ setup }: { setup: NonNullable<DashboardView['setup']> }) {
  const items = setup.items;
  return (
    <Card as="section" className={shared.panel}>
      <CardHead title={setup.title} />
      {items.length ? (
        <Table
          shade
          label="Set-up"
          headersHidden
          columns={[{ header: 'Done' }, { header: 'What' }, { header: 'Action', numeric: true }]}
          rows={items.map((i) => ({
            key: i.key,
            cells: [
              i.done ? (
                <StatusPill key="d" state="ok">
                  done
                </StatusPill>
              ) : (
                <VisuallyHidden key="d">not done</VisuallyHidden>
              ),
              i.label,
              i.action ? <ActionControl key="a" action={i.action} /> : '',
            ],
          }))}
        />
      ) : null}
      {setup.schedule ? (
        <div className={shared.foot} data-v2-setup-schedule="">
          <span>{setup.schedule.label}</span>
          {setup.schedule.action ? <ActionControl action={setup.schedule.action} /> : null}
        </div>
      ) : null}
      {setup.foot ? <div className={shared.foot}>{setup.foot}</div> : null}
    </Card>
  );
}

/**
 * The dashboard (Final-Dashboard-Day0 and Final-Dashboard): one component, two states from the view
 * model. On the first run, the site, the fixes to start with and what is worth setting up; after
 * it, what changed since the check before, the primary site's history and every site.
 */
export function DashboardScreen({
  data,
  notice,
}: Props & {
  /** A refused form's notice, on a live page. */
  notice?: NoticeView | null;
}) {
  return (
    <AccountFrame shell={data.shell}>
      <Header data={data} />
      <Notice notice={notice} />
      {data.startPro ? (
        <Card as="section" className={styles.startPro} data-v2-addition="">
          <CardHead title={data.startPro.title} />
          <div className={styles.startBody}>
            <p>{data.startPro.body}</p>
            <ActionControl action={data.startPro.start} size="md" />
          </div>
        </Card>
      ) : null}
      {data.firstRun ? (
        <>
          {data.blockedElsewhere.length ? <BlockedElsewhere data={data} /> : null}
          <Sites data={data} />
          {data.topFixes || data.setup ? (
            <section className={shared.two}>
              {data.topFixes ? <TopFixes top={data.topFixes} /> : null}
              {data.setup ? <Setup setup={data.setup} /> : null}
            </section>
          ) : null}
          {data.threeKinds ? (
            <Card as="section" className={styles.threeKinds}>
              <div className={styles.threeText}>
                <span className={styles.lead}>{data.threeKinds.lead}</span> {data.threeKinds.body}
              </div>
              <ActionControl action={data.threeKinds.settings} variant="quiet" />
            </Card>
          ) : null}
        </>
      ) : (
        <>
          {data.strip ? <Strip strip={data.strip} /> : null}
          {data.changed.length ? <Changed data={data} /> : null}
          {data.history ? (
            <section className={shared.twoOne}>
              <History data={data} />
              <CrawlersNow data={data} />
            </section>
          ) : null}
          {data.blockedElsewhere.length ? <BlockedElsewhere data={data} /> : null}
          <Sites data={data} />
          {data.setup ? (
            <section className={shared.two}>
              <Setup setup={data.setup} />
            </section>
          ) : null}
        </>
      )}
    </AccountFrame>
  );
}

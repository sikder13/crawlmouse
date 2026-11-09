import { Button } from '../../Button';
import { Card } from '../../Card';
import { CheckGlyphRow } from '../../CheckGlyphRow';
import { GradeHistory } from '../../GradeHistory';
import { Glyph, StatusPill } from '../../StatusPill';
import { Table } from '../../Table';
import { VERDICTS } from '../../verdicts';
import { VisuallyHidden } from '../../VisuallyHidden';
import { TAGGED_UA_LINE } from '../../../../lib/v2/copy/site';
import type { DashboardView } from '../../../../lib/v2/view/dashboard';
import { AccountFrame } from '../account/AccountFrame';
import { ActionControl } from '../account/ActionControl';
import { CardHead, GradeText } from '../account/parts';
import { spokenRun, verdictCell } from '../account/verdict-cells';
import shared from '../account/AccountScreen.module.css';
import styles from './DashboardScreen.module.css';

type Props = { data: DashboardView };

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
        <div className={styles.cellLabel}>Health, all sites · mean of both grades</div>
        <div className={styles.cellRow}>
          <span className={styles.big}>{h.value}</span>
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
        label="What changed, by site"
        headersHidden
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
        <span className={styles.legend}>
          <span className={styles.swatch} aria-hidden="true" />
          Technical SEO
        </span>
        <span className={styles.legend}>
          <span className={`${styles.swatch} ${styles.dashed}`} aria-hidden="true" />
          AI readability
        </span>
      </CardHead>
      <GradeHistory
        label={h.title}
        labels={h.points.map((p) => p.label)}
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
      <Table
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

function Sites({ data }: Props) {
  const { sites } = data;
  return (
    <Card as="section" className={shared.panel}>
      <CardHead title="Sites">
        <span className={shared.sub}>{sites.note}</span>
        {sites.upsell ? <ActionControl action={sites.upsell} /> : null}
      </CardHead>
      <Table
        label="Watched sites"
        rowHeader
        columns={[
          { header: 'Site', mono: true },
          { header: 'Technical SEO' },
          { header: 'AI readability' },
          { header: 'Since last crawl' },
          { header: 'Schedule', muted: true },
          { header: 'Last check', numeric: true, mono: true, muted: true },
        ]}
        rows={sites.rows.map((r) => ({
          key: r.key,
          cells: [
            <a key="h" href={r.href}>
              {r.host}
            </a>,
            <GradeText key="s" grade={r.seo} />,
            <GradeText key="a" grade={r.ai} withheld={r.aiWithheld} />,
            r.since.pills.length ? (
              <span key="c" className={shared.pills} data-v2-verdicts={r.since.verdicts.join(' ')}>
                {r.since.pills.map((p) => (
                  <StatusPill key={p.label} state={p.state}>
                    {p.label}
                  </StatusPill>
                ))}
              </span>
            ) : (
              <span key="c" className={shared.muted}>
                {r.sinceLabel}
              </span>
            ),
            r.schedule,
            r.lastCheck,
          ],
        }))}
      />
      {sites.foot ? <div className={shared.foot}>{sites.foot}</div> : null}
    </Card>
  );
}

function TopFixes({ top }: { top: NonNullable<DashboardView['topFixes']> }) {
  return (
    <Card as="section" className={shared.panel}>
      <CardHead title={top.title} />
      <Table
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

function Setup({ setup }: { setup: NonNullable<DashboardView['setup']> }) {
  const items = setup.schedule ? [...setup.items, setup.schedule] : setup.items;
  return (
    <Card as="section" className={shared.panel}>
      <CardHead title={setup.title} />
      <Table
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
      {setup.foot ? <div className={shared.foot}>{setup.foot}</div> : null}
    </Card>
  );
}

/**
 * The dashboard (Final-Dashboard-Day0 and Final-Dashboard): one component, two states from the view
 * model. On the first run, the site, the fixes to start with and what is worth setting up; after
 * it, what changed since the check before, the primary site's history and every site.
 */
export function DashboardScreen({ data }: Props) {
  return (
    <AccountFrame shell={data.shell}>
      <Header data={data} />
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

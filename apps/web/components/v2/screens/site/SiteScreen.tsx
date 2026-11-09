import { Card } from '../../Card';
import { CheckGlyph } from '../../CheckGlyphRow';
import { StatusPill } from '../../StatusPill';
import { Table } from '../../Table';
import { VisuallyHidden } from '../../VisuallyHidden';
import type { ShellView } from '../../../../lib/v2/view/account-shell';
import type { GradeCardView, SiteView } from '../../../../lib/v2/view/site';
import { AccountFrame } from '../account/AccountFrame';
import { ActionControl } from '../account/ActionControl';
import { CardHead } from '../account/parts';
import { verdictCell } from '../account/verdict-cells';
import { CopyText } from '../segment/CopyText';
import { AlertSwitch } from './AlertSwitch';
import { SITE_COPY } from '../../../../lib/v2/copy/site';
import shared from '../account/AccountScreen.module.css';
import styles from './SiteScreen.module.css';

/** One grade, as the locked page draws it: the letter, "79 · −1 since Thu", and its parts. */
function GradeHalf({ g }: { g: GradeCardView }) {
  return (
    <div className={styles.half}>
      <div className={styles.label}>{g.label}</div>
      {g.letter !== null ? (
        <div className={styles.gradeRow}>
          <span className={g.tone === 'bad' ? `${styles.letter} ${shared.bad}` : styles.letter}>
            {g.letter}
          </span>
          <span className={shared.score}>
            {g.move ? `${g.score} · ${g.move}` : String(g.score)}
          </span>
        </div>
      ) : (
        <div className={styles.gradeRow}>
          <span className={styles.letter} aria-hidden="true">
            –
          </span>
          <span className={shared.score}>withheld</span>
        </div>
      )}
      {g.withheld ? <div className={styles.parts}>{g.withheld}</div> : null}
      {g.parts ? (
        <div className={styles.parts} data-v2-verdicts={g.verdicts.join(' ')}>
          {g.parts}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The site page (Final-Site): one site's grades and crawlers across its checks, its fixes, its
 * settings and the alert rules that apply to it.
 */
export function SiteScreen({ data, shell }: { data: SiteView; shell: ShellView }) {
  const { header, grades, crawlers, fixes, settings, alerts } = data;
  return (
    <AccountFrame shell={shell} currentIs="location">
      <header className={shared.header}>
        <div>
          <h1 className={shared.title}>{header.title}</h1>
          <div className={shared.line}>{header.line}</div>
        </div>
        <div className={shared.actions}>
          {header.actions.map((a) => (
            <ActionControl key={a.label} action={a} size="md" />
          ))}
        </div>
      </header>

      <Card as="section" className={shared.panel}>
        <CardHead title={grades.title} sub={grades.sub}>
          {grades.actions.map((a) => (
            <ActionControl key={a.label} action={a} variant="quiet" />
          ))}
        </CardHead>
        <div className={`${shared.two} ${styles.halves}`}>
          {grades.cards.map((g) => (
            <GradeHalf key={g.label} g={g} />
          ))}
        </div>
        <div className={styles.grid}>
          <Table
            label="Crawler access by check"
            rowHeader
            columns={[
              { header: 'Crawler' },
              ...crawlers.columns.map((c, i) => ({
                header: (
                  <>
                    <span aria-hidden="true">{c}</span>
                    <VisuallyHidden>{crawlers.dates[i]!}</VisuallyHidden>
                  </>
                ),
              })),
              { header: 'Cause now' },
            ]}
            rows={crawlers.rows.map((r) => {
              const cells = r.verdicts.map((v) => verdictCell(v, r.group));
              return {
                key: r.ua,
                cells: [
                  r.changedNow ? <strong key="u">{r.ua}</strong> : r.ua,
                  ...cells.map((c, i) => <CheckGlyph key={i} cell={c} />),
                  <span key="c" className={r.cause === '—' ? shared.muted : undefined}>
                    {r.cause}
                  </span>,
                ],
              };
            })}
          />
          <div className={shared.note}>{crawlers.note}</div>
        </div>
      </Card>

      <Card as="section" className={shared.panel}>
        <CardHead title={fixes.title} sub={fixes.rows.length ? fixes.sub : null}>
          {fixes.copyAll ? (
            <CopyText text={fixes.copyAll.text}>{fixes.copyAll.label}</CopyText>
          ) : null}
        </CardHead>
        {fixes.rows.length ? (
          <Table
            label="Fixes"
            columns={[
              { header: 'No.', mono: true, muted: true },
              { header: 'Fix' },
              { header: 'Section' },
              { header: 'Effect, estimated', numeric: true, mono: true },
              { header: 'Status' },
              { header: <VisuallyHidden>Packet</VisuallyHidden>, numeric: true },
            ]}
            rows={[
              ...fixes.rows.map((f) => ({
                key: f.key,
                cells: [
                  String(f.number),
                  <span key="t">
                    {f.isNew ? <strong>{f.title}</strong> : f.title}
                    {f.newLabel ? (
                      <>
                        {' '}
                        <StatusPill state="bad">{f.newLabel}</StatusPill>
                      </>
                    ) : null}
                    {f.note ? (
                      // The locked page hides this note on a phone (table.fx td:nth-child(2) .mut).
                      <span
                        className={`${shared.muted} ${shared.phoneSecondary}`}
                        data-v2-phone-secondary=""
                      >
                        {' '}
                        · {f.note}
                      </span>
                    ) : null}
                    {f.diff ? <div className={styles.diff}>{f.diff}</div> : null}
                  </span>,
                  f.section,
                  f.effect,
                  <span key="s" className={shared.muted}>
                    {f.status}
                  </span>,
                  <ActionControl key="p" action={f.packet} variant="quiet" />,
                ],
              })),
              ...(fixes.rest
                ? [
                    {
                      key: 'rest',
                      muted: true,
                      cells: [
                        fixes.rest.numbers,
                        fixes.rest.title,
                        '—',
                        fixes.rest.effect,
                        fixes.rest.status,
                        <ActionControl key="a" action={fixes.rest.show} variant="quiet" />,
                      ],
                    },
                  ]
                : []),
            ]}
          />
        ) : (
          <div className={shared.note}>{SITE_COPY.noFixes}</div>
        )}
      </Card>

      <section className={`${shared.two} ${shared.twoWide}`}>
        <Card as="section" className={shared.panel}>
          <CardHead title="Settings for this site" />
          <Table
            label="Site settings"
            headersHidden
            rowHeader
            className={styles.settings}
            columns={[
              { header: 'Setting' },
              { header: 'Value' },
              { header: 'Change', numeric: true },
            ]}
            rows={settings.rows.map((r) => ({
              key: r.label,
              muted: r.muted,
              cells: [
                r.label,
                <span key="v" className={r.mono ? shared.mono : undefined}>
                  {r.value}
                </span>,
                r.action ? <ActionControl key="a" action={r.action} variant="quiet" /> : '',
              ],
            }))}
          />
        </Card>
        <Card as="section" className={shared.panel}>
          <CardHead title="Alerts for this site" />
          {alerts.rows.length ? (
            <Table
              label="Alert rules"
              headersHidden
              rowHeader
              columns={[
                { header: 'Rule' },
                { header: 'Last fired', numeric: true },
                { header: 'On', numeric: true },
              ]}
              rows={alerts.rows.map((r) => ({
                key: r.key,
                cells: [
                  <span key="l" data-v2-verdicts={r.verdicts.join(' ')}>
                    {r.label}
                  </span>,
                  r.fired ? (
                    <StatusPill key="f" state="bad">
                      {r.fired}
                    </StatusPill>
                  ) : (
                    <span key="f" className={shared.muted}>
                      {r.extra ?? ''}
                    </span>
                  ),
                  <AlertSwitch key="s" on={r.on} label={r.label} action={r.toggle} />,
                ],
              }))}
            />
          ) : (
            <div className={shared.note}>{SITE_COPY.noAlerts}</div>
          )}
          {alerts.rows.length ? <div className={shared.foot}>{alerts.foot}</div> : null}
        </Card>
      </section>
    </AccountFrame>
  );
}

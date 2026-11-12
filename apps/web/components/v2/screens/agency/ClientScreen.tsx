import { Card } from '../../Card';
import { StatusPill } from '../../StatusPill';
import { Table } from '../../Table';
import { CLIENT_COPY as COPY } from '../../../../lib/v2/copy/agency';
import type { ClientView } from '../../../../lib/v2/view/agency-client';
import { AccountFrame } from '../account/AccountFrame';
import { ActionControl } from '../account/ActionControl';
import { Notice, type NoticeView } from '../account/Notice';
import { CardHead } from '../account/parts';
import { GradeHalf } from '../site/SiteScreen';
import shared from '../account/AccountScreen.module.css';
import site from '../site/SiteScreen.module.css';

/**
 * One client (Final-Ag-Client), from the site page's pieces: the header, the two grades with their
 * moves, the fixes still to raise with their packets, and what the agency holds about the client.
 */
export function ClientScreen({
  data,
  notice,
}: {
  data: ClientView;
  /** A refused form's notice, on a live page. */
  notice?: NoticeView | null;
}) {
  const { header, grades, fixes, client } = data;
  const F = COPY.fixColumns;
  const S = COPY.clientColumns;
  return (
    <AccountFrame shell={data.shell} currentIs="location">
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
      <Notice notice={notice} />

      <Card as="section" className={shared.panel}>
        <CardHead title={grades.title} sub={grades.sub}>
          <ActionControl action={grades.site} variant="quiet" />
        </CardHead>
        <div className={`${shared.two} ${site.halves}`}>
          {grades.cards.map((g) => (
            <GradeHalf key={g.label} g={g} />
          ))}
        </div>
      </Card>

      <section className={`${shared.two} ${shared.twoWide}`}>
        <Card as="section" className={shared.panel}>
          <CardHead title={fixes.title} />
          {fixes.rows.length ? (
            <Table
              label={COPY.fixesLabel}
              headersHidden
              columns={[
                { header: F.number, mono: true, muted: true },
                { header: F.fix },
                { header: F.effect, numeric: true, mono: true },
                { header: F.packet, numeric: true },
              ]}
              rows={fixes.rows.map((f) => ({
                key: f.key,
                cells: [
                  String(f.number),
                  <span key="t">
                    {f.title}
                    {f.newLabel ? (
                      <>
                        {' '}
                        <StatusPill state="bad">{f.newLabel}</StatusPill>
                      </>
                    ) : null}
                  </span>,
                  f.effect,
                  <ActionControl key="p" action={f.packet} variant="quiet" />,
                ],
              }))}
            />
          ) : (
            <div className={shared.note}>{fixes.empty}</div>
          )}
          {fixes.more ? (
            <div className={shared.foot}>
              <a href={fixes.more.href}>{fixes.more.label}</a>
            </div>
          ) : null}
        </Card>

        <Card as="section" className={shared.panel}>
          <CardHead title={client.title} />
          <Table
            label={COPY.clientLabel}
            headersHidden
            rowHeader
            columns={[
              { header: S.setting },
              { header: S.value },
              { header: S.change, numeric: true },
            ]}
            rows={client.rows.map((r) => ({
              key: r.label,
              cells: [
                r.label,
                <span key="v" className={r.mono ? shared.mono : undefined}>
                  {r.value}
                </span>,
                r.change ? <ActionControl key="c" action={r.change} variant="quiet" /> : null,
              ],
            }))}
          />
        </Card>
      </section>
    </AccountFrame>
  );
}

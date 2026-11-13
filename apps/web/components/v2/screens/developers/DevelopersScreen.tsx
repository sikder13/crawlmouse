import { Button } from '../../Button';
import { Card } from '../../Card';
import { Heading } from '../../Heading';
import { PageShell } from '../../PageShell';
import { ScrollRegion } from '../../ScrollRegion';
import { StatusPill } from '../../StatusPill';
import { Table } from '../../Table';
import { LOG_IN, MARKETING_NAV } from '../../footer-links';
import type { DevelopersView } from '../../../../lib/v2/view/developers';
import { ComingMark } from '../agencies/Capability';
import { AuditForm } from '../home/AuditForm';
import { DeveloperListForm } from './DeveloperListForm';
import layout from '../../layout.module.css';
import styles from './DevelopersScreen.module.css';

/**
 * `live`: both forms post. `home-link`: the developer list posts, and the closing audit is a link to
 * the home's audit (public checks are off). `preview`: neither posts.
 */
export type DevelopersAudit = 'live' | 'preview' | 'home-link';

/**
 * Developers, v2 (Final-Developers, CC-29 D5). The one orange element is the closing audit's
 * button, as the artboard draws it; the developer list's button is neutral. The read API's card
 * carries the "coming" mark. The roadmap renders the statuses in lib/v2/copy/developers.ts: the
 * artboard's, except "Write API" and "MCP server", which read "planned" (rulings-3 Q37).
 */
export function DevelopersScreen({
  data,
  audit = 'preview',
}: {
  data: DevelopersView;
  audit?: DevelopersAudit;
}) {
  return (
    <PageShell
      nav={MARKETING_NAV}
      actions={
        <Button variant="quiet" href={LOG_IN.href}>
          {LOG_IN.label}
        </Button>
      }
    >
      <main>
        <section className={`${layout.wrap} ${styles.hero}`}>
          <Heading level={1} size="xl" className={styles.title}>
            {data.h1}
          </Heading>
          <p className={styles.sub}>{data.intro}</p>
        </section>

        <section className={`${layout.wrap} ${styles.g2}`}>
          <Card className={styles.flush}>
            <div className={styles.cardHead}>
              <Heading level={2} size="s">
                {data.sample.title} <ComingMark label={data.sample.coming} />
              </Heading>
            </div>
            <ScrollRegion label={data.sample.title} className={styles.packet}>
              <pre className={styles.packetText}>
                {data.sample.request}
                {'\n'}
                {data.sample.json}
              </pre>
            </ScrollRegion>
            <div className={styles.cardFoot}>
              <p className={styles.note}>{data.sample.shown}</p>
              <p className={styles.note}>{data.sample.notes}</p>
            </div>
          </Card>
          <div className={styles.stack}>
            <Card className={styles.flush}>
              <div className={styles.cardHead}>
                <Heading level={2} size="s">
                  {data.roadmap.title}
                </Heading>
                <div className={`${layout.mut} ${styles.small}`}>{data.roadmap.sub}</div>
              </div>
              <Table
                label="Roadmap"
                headersHidden
                columns={[{ header: 'Item' }, { header: 'Status', numeric: true }]}
                rows={data.roadmap.rows.map((r) => ({
                  key: r.item + (r.code ?? ''),
                  cells: [
                    <span key="i">
                      {r.item}
                      {r.code ? <span className={layout.mono}>{r.code}</span> : null}
                    </span>,
                    <StatusPill key="s" state="neutral">
                      {r.status}
                    </StatusPill>,
                  ],
                }))}
              />
            </Card>
            <Card className={styles.padded}>
              <Heading level={2} size="s">
                {data.waitlist.title}
              </Heading>
              <p className={styles.body}>{data.waitlist.body}</p>
              <DeveloperListForm copy={data.waitlist} live={audit !== 'preview'} />
            </Card>
          </div>
        </section>

        <section className={`${layout.wrap} ${styles.sec}`}>
          <Card className={styles.closing}>
            <div>
              <div className={styles.closingTitle}>{data.closing.title}</div>
              <div className={`${layout.mut} ${styles.small}`}>{data.closing.sub}</div>
            </div>
            {audit === 'home-link' ? (
              <Button variant="primary" href="/">
                {data.closing.homeLink}
              </Button>
            ) : (
              <AuditForm
                fieldId="url"
                label={data.closing.formLabel}
                primary
                start={audit === 'live'}
                className={styles.form}
                inputClassName={styles.formInput}
              />
            )}
          </Card>
        </section>
      </main>
    </PageShell>
  );
}

import { Fragment } from 'react';
import type { PricingView } from '@/lib/v2/view/pricing';
import { Button } from '../../Button';
import { Card } from '../../Card';
import { Heading } from '../../Heading';
import { PageShell } from '../../PageShell';
import { Table } from '../../Table';
import { VisuallyHidden } from '../../VisuallyHidden';
import { LOG_IN, MARKETING_NAV } from '../../footer-links';
import layout from '../../layout.module.css';
import { Capability, ComingMark } from '../agencies/Capability';
import { AgencyPlusForm, type ContactState } from './AgencyPlusForm';
import { PlanButton } from './PlanButton';
import styles from './Pricing.module.css';

export const AGENCY_PLUS_ANCHOR = 'agency-plus';

/**
 * Final-Pricing (CC-29 D2): the three plans on the chosen interval, the Agency Plus row with its
 * contact form under it, what happens when the trial ends, and the questions. Every sentence and
 * number comes from `pricingView`; `contact` fixes the form's state for previews. A sentence that
 * names a capability carries it (`data-capability`), with For agencies' "coming" mark when one of
 * them is not built.
 */
export function PricingScreen({ view, contact }: { view: PricingView; contact?: ContactState }) {
  return (
    <PageShell
      nav={MARKETING_NAV}
      footerLineMark={view.footerComing ? <ComingMark label={view.footerComing} /> : null}
      actions={
        <Button variant="quiet" href={LOG_IN.href}>
          {LOG_IN.label}
        </Button>
      }
    >
      <main>
        <section className={`${layout.wrap} ${styles.hero}`}>
          <Heading level={1} size="xl" className={styles.title}>
            <Capability item={view.title} comingLabel={view.comingLabel} />
          </Heading>
          <p className={styles.lead}>
            {view.lead.map((t, i) => (
              <Fragment key={t.text}>
                {i > 0 ? ' ' : null}
                <Capability item={t} comingLabel={view.comingLabel} />
              </Fragment>
            ))}
          </p>
          <nav className={`${layout.row} ${styles.intervals}`} aria-label="Billing interval">
            {view.intervals.map((i) =>
              i.current ? (
                <Button key={i.interval} presentational>
                  {i.label}
                  <VisuallyHidden>, shown</VisuallyHidden>
                </Button>
              ) : (
                <Button key={i.interval} variant="quiet" href={i.href}>
                  {i.label}
                </Button>
              ),
            )}
          </nav>
        </section>

        <section className={`${layout.wrap} ${styles.plans}`} aria-label="Plans">
          {view.plans.map((plan) => (
            <Card key={plan.tier} className={styles.plan}>
              <div className={`${layout.row} ${styles.planHead}`}>
                <Heading level={2} size="s">
                  {plan.name}
                </Heading>
                <span className={styles.tag}>{plan.tag}</span>
              </div>
              <div className={`${layout.row} ${styles.priceRow}`}>
                <span className={styles.price}>{plan.price}</span>
                <span className={styles.per}>{plan.per}</span>
              </div>
              <Capability
                as="div"
                className={styles.description}
                item={plan.description}
                comingLabel={view.comingLabel}
              />
              <ul className={styles.rows}>
                {plan.rows.map((row) => (
                  <li
                    key={row.label}
                    className={styles.row}
                    data-capability={row.capabilities.join(' ')}
                  >
                    <span className={styles.rowLabel}>{row.label}</span>
                    <span className={styles.rowText}>
                      {row.text}
                      {row.coming ? (
                        <>
                          {' '}
                          <ComingMark label={view.comingLabel} />
                        </>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
              <div className={styles.actionArea}>
                <PlanButton action={plan.action} />
              </div>
            </Card>
          ))}
        </section>

        <section className={`${layout.wrap} ${styles.plus}`} aria-label={view.agencyPlus.name}>
          <Table
            label={view.agencyPlus.name}
            headersHidden
            rowHeader
            columns={[
              { header: 'Plan' },
              { header: 'Limits' },
              { header: 'Price' },
              { header: 'Contact' },
            ]}
            rows={[
              {
                key: 'agency-plus',
                cells: [
                  view.agencyPlus.name,
                  <Capability
                    key="limits"
                    item={view.agencyPlus.limits}
                    comingLabel={view.comingLabel}
                  />,
                  view.agencyPlus.price,
                  <a key="link" href={`#${AGENCY_PLUS_ANCHOR}`}>
                    {view.agencyPlus.link}
                  </a>,
                ],
              },
            ]}
          />
          <Card as="section" id={AGENCY_PLUS_ANCHOR} className={styles.contact}>
            <Heading level={2} size="s">
              {view.agencyPlus.formTitle}
            </Heading>
            {view.agencyPlus.form ? (
              <>
                <Capability as="p" item={view.agencyPlus.reply} comingLabel={view.comingLabel} />
                <AgencyPlusForm initial={contact} />
              </>
            ) : (
              <p>
                Write to <a href={`mailto:${view.agencyPlus.inbox}`}>{view.agencyPlus.inbox}</a>{' '}
                with your agency’s name and how many client sites you run.
              </p>
            )}
          </Card>
        </section>

        <div className={`${layout.wrap} ${styles.footnote}`}>
          {[view.crawlers, view.annual].map((pieces) => (
            <p key={pieces[0]!.text}>
              {pieces.map((t, i) => (
                <Fragment key={t.text}>
                  {i > 0 ? ' ' : null}
                  <Capability item={t} comingLabel={view.comingLabel} />
                </Fragment>
              ))}
            </p>
          ))}
        </div>

        <section className={`${layout.wrap} ${styles.section}`}>
          <Card className={styles.cardFlush}>
            <div className={styles.cardHead}>
              <Heading level={2} size="s">
                {view.after.title}
              </Heading>
              <div className={styles.cardLead}>
                {view.after.lead.map((t, i) => (
                  <Fragment key={t.text}>
                    {i > 0 ? ' ' : null}
                    <Capability item={t} comingLabel={view.comingLabel} />
                  </Fragment>
                ))}
              </div>
            </div>
            <Table
              label="After the trial"
              columns={view.after.columns.map((header, i) => ({ header, muted: i === 0 }))}
              rows={view.after.rows.map(([what, happens]) => ({
                key: what,
                cells: [
                  what,
                  <Capability key="happens" item={happens} comingLabel={view.comingLabel} />,
                ],
              }))}
            />
          </Card>
        </section>

        <section className={`${layout.wrap} ${styles.pair} ${styles.bottom}`}>
          <Card className={styles.pairCard}>
            <Heading level={2} size="s">
              {view.why.title}
            </Heading>
            <p className={styles.text}>
              {view.why.text.map((t, i) => (
                <Fragment key={t.text}>
                  {i > 0 ? ' ' : null}
                  <Capability item={t} comingLabel={view.comingLabel} />
                </Fragment>
              ))}
            </p>
          </Card>
          <Card className={styles.pairCard}>
            <Heading level={2} size="s">
              {view.faq.title}
            </Heading>
            <dl className={styles.faq}>
              {view.faq.items.map((item) => (
                <div key={item.q}>
                  <dt>{item.q}</dt>
                  <dd>
                    <Capability item={item.a} comingLabel={view.comingLabel} />
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        </section>
      </main>
    </PageShell>
  );
}

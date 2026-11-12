import { Fragment } from 'react';
import { AGENCY_TRIAL_COPY as COPY } from '@/lib/v2/copy/agency-trial';
import type { AgencyTrialView, ManageView, PageForm } from '@/lib/v2/view/agency-trial';
import { Button } from '../../Button';
import { Capability } from '../agencies/Capability';
import { Card } from '../../Card';
import { Heading } from '../../Heading';
import { PageShell } from '../../PageShell';
import { MARKETING_NAV } from '../../footer-links';
import layout from '../../layout.module.css';
import { AgencyTrialForm, type TrialFormState } from './AgencyTrialForm';
import styles from './AgencyTrial.module.css';

/** A form of the page: hidden fields and one default (never orange) button. */
function PlainForm({ form }: { form: PageForm }) {
  return (
    <form method={form.method} action={form.action} className={styles.manageForm}>
      {Object.entries(form.fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit">{form.label}</Button>
    </form>
  );
}

/** Q26: each owned agency account's Manage billing and Cancel, naming the account. */
function Manage({ manage }: { manage: ManageView[] }) {
  if (manage.length === 0) return null;
  return (
    <section className={styles.manage} aria-label={COPY.manage.title}>
      <Heading level={2} size="s">
        {COPY.manage.title}
      </Heading>
      {manage.map((m) => (
        <Card key={m.accountId} className={styles.manageCard}>
          <div className={styles.asideTitle}>{m.title}</div>
          <p className={styles.fine}>{m.text}</p>
          {m.cancel?.confirm ? (
            <p className={styles.notice} role="status">
              {m.cancel.confirm.text}
            </p>
          ) : null}
          <div className={styles.manageRow}>
            {m.portal ? <PlainForm form={m.portal} /> : null}
            {m.cancel ? <PlainForm form={m.cancel.confirm ?? m.cancel.ask} /> : null}
          </div>
        </Card>
      ))}
    </section>
  );
}

/**
 * Final-AgencyTrial (CC-29 D3): the step before Stripe's Checkout, for a signed-in person, beside
 * what Agency includes. A person who holds Agency or has used the trial sees why there is no form.
 * An owner of an agency account on the trial, Agency or past due also sees its billing and Cancel.
 * `form` fixes the form's state, for previews.
 */
export function AgencyTrialScreen({
  view,
  form,
}: {
  view: AgencyTrialView;
  form?: TrialFormState;
}) {
  return (
    <PageShell nav={MARKETING_NAV}>
      <main className={`${layout.wrap} ${styles.main}`}>
        {view.kind === 'form' ? (
          <div className={styles.grid}>
            <section>
              <Heading level={1} size="m">
                {view.title}
              </Heading>
              <p className={styles.lead}>
                {view.lead.map((t, i) => (
                  <Fragment key={t.text}>
                    {i > 0 ? ' ' : null}
                    <Capability item={t} comingLabel={view.comingLabel} />
                  </Fragment>
                ))}
              </p>
              {view.returning ? (
                <p className={styles.notice} role="status">
                  {view.returning}
                </p>
              ) : null}
              <AgencyTrialForm view={view} initial={form} />
              <div className={styles.other}>
                <p className={styles.fine}>{COPY.secondAccount}</p>
                <p className={styles.fine}>
                  {COPY.notSure}{' '}
                  <a className={styles.underline} href="/pricing">
                    {COPY.pricing}
                  </a>
                  .
                </p>
              </div>
            </section>
            <Card as="section" className={styles.aside}>
              <div className={styles.asideHead}>
                <div className={styles.asideKicker}>{view.aside.kicker}</div>
                <Capability
                  as="div"
                  className={styles.asideTitle}
                  item={view.aside.title}
                  comingLabel={view.comingLabel}
                />
              </div>
              <table className={styles.table} aria-label="What Agency includes">
                <tbody>
                  {view.aside.rows.map(([what, value]) => (
                    <tr key={what.text}>
                      <td>
                        <Capability item={what} comingLabel={view.comingLabel} />
                      </td>
                      <td className={styles.n}>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Capability
                as="div"
                className={styles.foot}
                item={view.aside.foot}
                comingLabel={view.comingLabel}
              />
            </Card>
          </div>
        ) : (
          <section className={styles.single}>
            <Heading level={1} size="m">
              {view.title}
            </Heading>
            <p className={styles.lead}>{view.text}</p>
            <div className={styles.other}>
              <Button href="/pricing">{COPY.seePlans}</Button>
            </div>
          </section>
        )}
        <Manage manage={view.manage} />
      </main>
    </PageShell>
  );
}

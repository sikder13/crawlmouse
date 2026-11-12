import { AGENCY_TRIAL_COPY as COPY } from '@/lib/v2/copy/agency-trial';
import type { AgencyTrialView } from '@/lib/v2/view/agency-trial';
import { Button } from '../../Button';
import { Card } from '../../Card';
import { Heading } from '../../Heading';
import { PageShell } from '../../PageShell';
import { MARKETING_NAV } from '../../footer-links';
import layout from '../../layout.module.css';
import { AgencyTrialForm, type TrialFormState } from './AgencyTrialForm';
import styles from './AgencyTrial.module.css';

/**
 * Final-AgencyTrial (CC-29 D3): the step before Stripe's Checkout, for a signed-in person, beside
 * what Agency includes. A person who holds Agency or has used the trial sees why there is no form.
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
              <p className={styles.lead}>{view.lead}</p>
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
                <div className={styles.asideTitle}>{view.aside.title}</div>
              </div>
              <table className={styles.table} aria-label="What Agency includes">
                <tbody>
                  {view.aside.rows.map(([what, value]) => (
                    <tr key={what}>
                      <td>{what}</td>
                      <td className={styles.n}>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className={styles.foot}>{view.aside.foot}</div>
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
      </main>
    </PageShell>
  );
}

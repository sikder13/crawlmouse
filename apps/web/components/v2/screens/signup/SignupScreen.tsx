import { Card } from '../../Card';
import { Heading } from '../../Heading';
import { PageShell } from '../../PageShell';
import { Button } from '../../Button';
import { LOG_IN, MARKETING_NAV } from '../../footer-links';
import layout from '../../layout.module.css';
import { planFootnote, planGroups, signupLead, trialDays } from './door-copy';
import { SignupForm, type SignupFormState } from './SignupForm';
import styles from './Signup.module.css';

/**
 * Final-Signup (CC-25): the email, an optional first site, and what the account is. The table and
 * every number on the page come from door-copy.ts; `checksPublic` is V2_CHECKS_PUBLIC, read by the route.
 */
export function SignupScreen({
  checksPublic,
  initial,
}: {
  checksPublic: boolean;
  /** Fix the form's state, for previews and tests. */
  initial?: SignupFormState;
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
      <main className={`${layout.wrap} ${styles.main}`}>
        <div className={styles.grid}>
          <section>
            <Heading level={1} size="m">
              One email, and the account is yours.
            </Heading>
            <p className={styles.lead}>{signupLead()}</p>
            <SignupForm checksPublic={checksPublic} initial={initial} />
            <div className={styles.other}>
              Already have an account? Use the same form; the link signs you in.
              {/* The audit page keeps an audit once it is served publicly, which sets V2_CHECKS_PUBLIC. */}
              {checksPublic
                ? ' Running an audit right now? Keep it from the audit page instead and it becomes your first site.'
                : null}
            </div>
          </section>
          <Card as="section" className={styles.aside}>
            <div className={styles.asideHead}>
              <div className={styles.asideKicker}>What the account is</div>
              <div className={styles.asideTitle}>Free, with {trialDays} of Pro to start</div>
            </div>
            <table className={styles.table} aria-label="What your account includes">
              <tbody>
                {planGroups().flatMap((group) => [
                  <tr key={group.heading}>
                    <th scope="colgroup">{group.heading}</th>
                    <th scope="col" className={styles.n}>
                      {group.plan}
                    </th>
                  </tr>,
                  ...group.rows.map((row) => (
                    <tr key={row.what}>
                      <td>{row.what}</td>
                      <td className={`${styles.n} ${styles.mut}`}>{row.value}</td>
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
            <div className={styles.foot}>{planFootnote()}</div>
          </Card>
        </div>
      </main>
    </PageShell>
  );
}

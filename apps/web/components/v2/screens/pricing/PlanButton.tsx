import type { PlanAction } from '@/lib/v2/view/pricing';
import { Button } from '../../Button';
import styles from './Pricing.module.css';

/**
 * A plan's button, as `pricingView` decided it: a link, a form that posts to a billing route (which
 * answers a form with a redirect when it succeeds), the plan the account is on, or a sentence where a
 * button would be.
 */
export function PlanButton({ action }: { action: PlanAction }) {
  if (action.kind === 'note') {
    return <div className={styles.actionNote}>{action.note}</div>;
  }
  const variant = action.kind !== 'current' && action.primary ? 'primary' : 'default';
  return (
    <>
      {action.kind === 'link' ? (
        <Button href={action.href} variant={variant} className={styles.action}>
          {action.label}
        </Button>
      ) : action.kind === 'form' ? (
        <form method="post" action={action.action}>
          {Object.entries(action.fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <Button type="submit" variant={variant} className={styles.action}>
            {action.label}
          </Button>
        </form>
      ) : (
        <Button presentational variant="quiet" className={styles.action}>
          {action.label}
        </Button>
      )}
      <div className={styles.actionNote}>{action.note}</div>
    </>
  );
}

import Link from 'next/link';
import { buttonClasses } from '../ui/Button';
import { Card } from '../ui/Card';

// The free-tier STAY beat — the tail of the conversion spine for a signed-OUT viewer. A one-shot
// result becomes something they can monitor by creating a free account (which also claims this audit
// via anon-claim-on-signup). A signed-in owner already has this in their dashboard, so the beat is
// gated to signed-out viewers upstream (ResultView).
export function SaveAndMonitorCta() {
  return (
    <Card className="flex flex-wrap items-center justify-between gap-4 border-l-4 border-l-sage">
      <div>
        <h3 className="font-display text-h3">Keep an eye on this grade</h3>
        <p className="mt-1 max-w-prose text-body text-ink-muted">
          Create a free account to save this audit and re-audit anytime — watch your grade climb as you
          fix things.
        </p>
      </div>
      <Link href={{ pathname: '/login' }} className={buttonClasses({ variant: 'primary', className: 'shrink-0' })}>
        Save &amp; monitor — free
      </Link>
    </Card>
  );
}

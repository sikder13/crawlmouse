'use client';

import Link from 'next/link';
import { track } from '@/lib/analytics';
import { buttonClasses } from '@/components/ui/Button';
import { stashReturnTo } from './post-upgrade-return';

// The upgrade CTA. Uses a plain <Link> (SSR-safe, no router context needed) + an onClick that stashes
// the return target (so the just-paid user lands back on the cure) and fires the upgrade_clicked
// spine event. `returnTo` is optional — generic paywalls just go to /pricing.
export function UpgradeLink({ returnTo, label = 'Unlock Pro · $19 →' }: { returnTo?: string; label?: string }) {
  function onClick() {
    if (returnTo) stashReturnTo(returnTo);
    track('upgrade_clicked', returnTo ? { returnTo } : {});
  }
  return (
    <Link
      href={{ pathname: '/pricing' }}
      onClick={onClick}
      className={buttonClasses({ variant: 'primary', size: 'sm' })}
    >
      {label}
    </Link>
  );
}

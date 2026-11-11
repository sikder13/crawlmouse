'use client';

import type { FormEvent, ReactNode } from 'react';
import { useLive } from '../account/LiveActions';

/**
 * A POST form that a preview stops, as ActionControl and KeepBar do, so filling it in there changes
 * nothing. Under `LiveActions` (a page served from a signed-in account) it submits.
 */
export function StoppedForm({
  action,
  className,
  children,
}: {
  action: string;
  className?: string;
  children: ReactNode;
}) {
  const live = useLive();
  return (
    <form
      method="post"
      action={action}
      className={className}
      onSubmit={live ? undefined : (e: FormEvent) => e.preventDefault()}
    >
      {children}
    </form>
  );
}

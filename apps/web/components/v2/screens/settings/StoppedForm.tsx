'use client';

import type { FormEvent, ReactNode } from 'react';

/**
 * A POST form whose route is not built yet (CC-27b): the preview stops its submit, as ActionControl
 * and KeepBar do, so filling it in changes nothing.
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
  return (
    <form
      method="post"
      action={action}
      className={className}
      onSubmit={(e: FormEvent) => e.preventDefault()}
    >
      {children}
    </form>
  );
}

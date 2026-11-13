'use client';

import type { FormEvent, ReactNode } from 'react';
import { useLive } from './LiveActions';

const URLENCODED = 'application/x-www-form-urlencoded';

/** A POST form that submits on a live page and is inert on a preview, as `ActionControl`'s are. */
export function PostForm({
  action,
  method,
  className,
  children,
}: {
  action: string;
  /** The verb an HTML form lacks, sent as `_method`. */
  method?: 'PATCH' | 'PUT' | 'DELETE';
  className?: string;
  children: ReactNode;
}) {
  const live = useLive();
  const stop = (e: FormEvent) => e.preventDefault();
  return (
    <form
      method="post"
      action={action}
      encType={URLENCODED}
      className={className}
      onSubmit={live ? undefined : stop}
    >
      {method ? <input type="hidden" name="_method" value={method} /> : null}
      {children}
    </form>
  );
}

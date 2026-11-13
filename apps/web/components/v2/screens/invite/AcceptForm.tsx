'use client';

import type { FormEvent } from 'react';
import { Button } from '../../Button';
import { useLive } from '../account/LiveActions';

/**
 * The accept form: the route reads the link's token from its cookie, and the form posts no field
 * but the hidden ones it is given. It submits on the live page and is inert on a preview.
 */
export function AcceptForm({
  action,
  label,
  fields,
  quiet = false,
}: {
  action: string;
  label: string;
  /** Hidden fields the form posts, for a route that reads one. */
  fields?: Readonly<Record<string, string>>;
  /** A second action on a page: drawn as the secondary button. */
  quiet?: boolean;
}) {
  const live = useLive();
  const stop = (e: FormEvent) => e.preventDefault();
  return (
    <form
      method="post"
      action={action}
      encType="application/x-www-form-urlencoded"
      onSubmit={live ? undefined : stop}
    >
      {Object.entries(fields ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" variant={quiet ? 'default' : 'primary'}>
        {label}
      </Button>
    </form>
  );
}

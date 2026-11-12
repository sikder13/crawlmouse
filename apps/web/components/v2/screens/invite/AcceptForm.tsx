'use client';

import type { FormEvent } from 'react';
import { Button } from '../../Button';
import { useLive } from '../account/LiveActions';

/**
 * The accept form: it posts no field (the route reads the invitation's token from its cookie). It
 * submits on the live page and is inert on a preview.
 */
export function AcceptForm({ action, label }: { action: string; label: string }) {
  const live = useLive();
  const stop = (e: FormEvent) => e.preventDefault();
  return (
    <form
      method="post"
      action={action}
      encType="application/x-www-form-urlencoded"
      onSubmit={live ? undefined : stop}
    >
      <Button type="submit" variant="primary">
        {label}
      </Button>
    </form>
  );
}

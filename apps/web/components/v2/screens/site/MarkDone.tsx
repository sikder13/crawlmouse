'use client';

import type { ActionView } from '../../../../lib/v2/view/account-actions';
import { ActionControl } from '../account/ActionControl';
import { useLive } from '../account/LiveActions';

/** A fix row's Mark done (an addition to the locked page), on a live page only. */
export function MarkDone({ action }: { action: ActionView }) {
  if (!useLive()) return null;
  return (
    <span data-v2-addition="">
      <ActionControl action={action} variant="quiet" />
    </span>
  );
}

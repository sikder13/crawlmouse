'use client';
import { useEffect } from 'react';
import { track } from '@/lib/analytics';
import type { FunnelEvent } from '@/lib/analytics-events';

/** Fire-once view tracker so a server component can emit a funnel view event on mount. */
export function TrackView({ event, props }: { event: FunnelEvent; props?: Record<string, unknown> }) {
  // Fire exactly once on mount; `event`/`props` are stable for a given render of a view.
  useEffect(() => {
    track(event, props);
  }, []);
  return null;
}

'use client';

import { useRef, type ReactNode, type SyntheticEvent } from 'react';
import { track } from '@/lib/analytics';
import type { FunnelEvent } from '@/lib/analytics-events';

interface Props {
  event: FunnelEvent;
  summary: ReactNode;
  children: ReactNode;
  props?: Record<string, unknown>;
}

// A native <details> disclosure that fires a typed funnel event ONCE — the first time it's opened.
// Native <details> stays keyboard-accessible + SSR-safe (works without JS); the useRef guard makes the
// analytics fire exactly once, so re-opening never double-counts.
export function TrackedDetails({ event, summary, children, props }: Props) {
  const fired = useRef(false);

  function onToggle(e: SyntheticEvent<HTMLDetailsElement>) {
    if (e.currentTarget.open && !fired.current) {
      fired.current = true;
      track(event, props);
    }
  }

  return (
    <details className="group" onToggle={onToggle}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-control text-caption font-medium text-ink-muted underline decoration-dotted underline-offset-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-peach focus-visible:ring-offset-2 focus-visible:ring-offset-cream">
        {summary}
        <span
          aria-hidden="true"
          className="transition-transform group-open:rotate-90 motion-reduce:transition-none"
        >
          ›
        </span>
      </summary>
      <div className="mt-2 max-w-prose text-caption leading-relaxed text-ink-muted">{children}</div>
    </details>
  );
}

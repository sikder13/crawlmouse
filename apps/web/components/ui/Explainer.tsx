import type { ReactNode } from 'react';

interface Props {
  summary?: string;
  children: ReactNode;
  className?: string;
}

// Progressive-disclosure comprehension primitive (SPEC 03 Part 2): a calm, keyboard-accessible
// "what does this mean / why it matters" expander. Native <details> → works without JS, SSR-safe,
// and screen-reader friendly. Experts skip it; beginners open it.
export function Explainer({ summary = 'What does this mean?', children, className = '' }: Props) {
  return (
    <details className={`group ${className}`}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-control text-caption font-medium text-ink-muted underline decoration-dotted underline-offset-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-peach focus-visible:ring-offset-2 focus-visible:ring-offset-cream">
        {summary}
        <span aria-hidden="true" className="transition-transform group-open:rotate-90 motion-reduce:transition-none">
          ›
        </span>
      </summary>
      <div className="mt-2 max-w-prose text-caption leading-relaxed text-ink-muted">{children}</div>
    </details>
  );
}

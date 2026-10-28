import type { ReactNode } from 'react';
import layout from './layout.module.css';

/** Text for screen readers only. It is in the DOM and read in order, but takes no space. */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return (
    <span className={layout.srOnly} data-v2-sr-only="">
      {children}
    </span>
  );
}

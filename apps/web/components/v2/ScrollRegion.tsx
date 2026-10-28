'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A horizontal scroll wrapper that joins the tab order only while its content overflows, so a
 * keyboard user can scroll it and a table that fits adds no stray tab stop. It checks again when
 * its size changes and when its content does (a log gaining a line).
 */
export function ScrollRegion({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    check();
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(check);
    mo?.observe(el, { childList: true, subtree: true, characterData: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(check);
    ro?.observe(el);
    return () => {
      mo?.disconnect();
      ro?.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      data-v2-scroll-region=""
      {...(scrolls ? { role: 'region', 'aria-label': label, tabIndex: 0 } : {})}
    >
      {children}
    </div>
  );
}

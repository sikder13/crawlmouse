'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A horizontal scroll wrapper that joins the tab order only while its content overflows, so a
 * keyboard user can scroll it and a table that fits adds no stray tab stop.
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
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
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

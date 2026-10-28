'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A horizontal scroll wrapper that joins the tab order only while its content overflows, so a
 * keyboard user can scroll it and a table that fits adds no stray tab stop. It checks again when
 * its size changes and when its content does (a log gaining a line); while it holds focus it keeps
 * its place in the tab order.
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
    // While it holds focus it stays in the tab order, or focus would fall back to the page.
    const check = () =>
      setScrolls(el.scrollWidth > el.clientWidth + 1 || document.activeElement === el);
    check();
    // Once focus leaves it, it is checked again, so a tab stop kept only for focus is let go.
    const left = () => setTimeout(check, 0);
    el.addEventListener('focusout', left);
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(check);
    mo?.observe(el, { childList: true, subtree: true, characterData: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(check);
    ro?.observe(el);
    return () => {
      el.removeEventListener('focusout', left);
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

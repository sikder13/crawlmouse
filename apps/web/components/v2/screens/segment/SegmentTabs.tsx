'use client';

import { useEffect, useRef } from 'react';
import type { SegmentFrame } from '../../../../lib/v2/view/segment/frame';
import layout from '../../layout.module.css';
import { revealOnFocus } from './SegmentParts';
import styles from './SegmentScreen.module.css';

/** The measures the opening scroll reads: the strip's widths and position, and the current tab's. */
export interface StripMeasures {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
  tabLeft: number;
  tabWidth: number;
}

/**
 * Where the strip opens: the current tab centred, or null to leave it where it is. Null when the
 * strip fits, and when something has already scrolled it before the page hydrated, a reader's swipe
 * or a test scrolling it to an end, so the opening position never overwrites a scroll already made.
 */
export function openingScroll(m: StripMeasures): number | null {
  if (m.scrollWidth <= m.clientWidth || m.scrollLeft !== 0) return null;
  return m.tabLeft - (m.clientWidth - m.tabWidth) / 2;
}

/**
 * The section tabs. Where they do not fit (a phone), the strip scrolls sideways and opens with the
 * current tab centred (DESIGN-LOCK §6), set once on mount without animation (rule 13), unless it has
 * already been scrolled by then (`openingScroll`).
 */
export function SegmentTabs({ tabs }: { tabs: SegmentFrame['tabs'] }) {
  const strip = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = strip.current;
    const on = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !on) return;
    const left = openingScroll({
      scrollLeft: nav.scrollLeft,
      scrollWidth: nav.scrollWidth,
      clientWidth: nav.clientWidth,
      tabLeft: on.offsetLeft,
      tabWidth: on.offsetWidth,
    });
    if (left !== null) nav.scrollLeft = left;
  }, []);

  return (
    // It scrolls sideways when it does not fit, so it is marked as a scroll region (the visual
    // harness reads that mark), and a tab reached by keyboard is brought fully into view.
    <nav
      ref={strip}
      className={`${layout.row} ${styles.tabs}`}
      aria-label="Sections"
      data-v2-scroll-region=""
      onFocus={revealOnFocus}
    >
      {tabs.map((t) => (
        <a
          key={t.label}
          href={t.href}
          className={t.current ? `${styles.tab} ${styles.tabOn}` : styles.tab}
          aria-current={t.current ? 'page' : undefined}
          data-v2-addition={t.added ? '' : undefined}
        >
          {t.label}
        </a>
      ))}
    </nav>
  );
}

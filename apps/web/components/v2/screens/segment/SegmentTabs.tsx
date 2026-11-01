'use client';

import { useEffect, useRef } from 'react';
import type { SegmentFrame } from '../../../../lib/v2/view/segment/frame';
import layout from '../../layout.module.css';
import styles from './SegmentScreen.module.css';

/**
 * The section tabs. Where they do not fit (a phone), the strip scrolls sideways and opens with the
 * current tab centred (DESIGN-LOCK §6), set once on mount without animation (rule 13).
 */
export function SegmentTabs({ tabs }: { tabs: SegmentFrame['tabs'] }) {
  const strip = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = strip.current;
    const on = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !on || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft = on.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2;
  }, []);

  return (
    // It scrolls sideways when it does not fit, so it is marked as a scroll region (the visual
    // harness reads that mark), and a tab reached by keyboard is brought fully into view.
    <nav
      ref={strip}
      className={`${layout.row} ${styles.tabs}`}
      aria-label="Sections"
      data-v2-scroll-region=""
      onFocus={(e) => e.target.scrollIntoView({ block: 'nearest', inline: 'nearest' })}
    >
      {tabs.map((t) => (
        <a
          key={t.label}
          href={t.href}
          className={t.current ? `${styles.tab} ${styles.tabOn}` : styles.tab}
          aria-current={t.current ? 'page' : undefined}
        >
          {t.label}
        </a>
      ))}
    </nav>
  );
}

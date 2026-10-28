'use client';

import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import type { NavGroup } from './footer-links';
import styles from './NavMenu.module.css';

/**
 * A header item that opens a list of links: a button that says whether the list is shown
 * (`aria-expanded`) and the list it controls. The disclosure pattern for site navigation, not an
 * ARIA menu, so Tab moves through the links as anywhere else on the page. Escape closes it and
 * hands focus back to the button; a press outside it, or focus moving to an element outside it,
 * closes it too.
 */
export function NavMenu({ group }: { group: NavGroup }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const press = (e: Event) => {
      if (e.target instanceof Node && root.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', press);
    return () => document.removeEventListener('pointerdown', press);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !open) return;
    setOpen(false);
    button.current?.focus();
  };

  // Focus moving to another element outside closes the list. With no next element (focus left the
  // page, or a press on nothing focusable) it stays; a press outside is handled above.
  const onBlur = (e: FocusEvent) => {
    const next = e.relatedTarget;
    if (next instanceof Node && !root.current?.contains(next)) setOpen(false);
  };

  return (
    <div
      ref={root}
      className={styles.menu}
      data-v2-nav-menu=""
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      <button
        ref={button}
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        {group.label}
        {/* The open-or-closed cue of a disclosure button: it marks a state, not a link (rule 10). */}
        <svg className={styles.chevron} viewBox="0 0 10 6" aria-hidden="true" focusable="false">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      <ul id={id} className={styles.panel} hidden={!open}>
        {group.items.map((item) => (
          <li key={item.label}>
            {item.planned ? (
              <span className={styles.planned} data-v2-planned="">
                {item.label}
              </span>
            ) : (
              <a href={item.href}>{item.label}</a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

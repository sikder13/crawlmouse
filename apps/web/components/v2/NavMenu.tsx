'use client';

import { useEffect, useId, useRef, useState, type FocusEvent } from 'react';
import type { NavGroup } from './footer-links';
import styles from './NavMenu.module.css';

/**
 * A header item that opens a list of links: a button that says whether the list is shown
 * (`aria-expanded`) and the list it controls. The disclosure pattern for site navigation, not an
 * ARIA menu, so Tab moves through the links as anywhere else on the page. Escape closes it from
 * anywhere on the page, and hands focus back to the button when focus was in the menu or on
 * nothing; a press outside it, or focus moving to an element outside it, closes it too.
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
    // On the document, not the menu: after a mouse open, focus may be on nothing (a click on the
    // panel's padding, or Safari, which does not focus a clicked button).
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const active = document.activeElement;
      const lost = !active || active === document.body || Boolean(root.current?.contains(active));
      setOpen(false);
      if (lost) button.current?.focus();
    };
    document.addEventListener('pointerdown', press);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', press);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  // Focus moving to another element outside closes the list. With no next element (focus left the
  // page, or a press on nothing focusable) it stays; a press outside is handled above.
  const onBlur = (e: FocusEvent) => {
    const next = e.relatedTarget;
    if (next instanceof Node && !root.current?.contains(next)) setOpen(false);
  };

  return (
    <div ref={root} className={styles.menu} data-v2-nav-menu="" onBlur={onBlur}>
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

'use client';

import { useEffect, useId, useRef, useState, type FocusEvent, type FormEvent } from 'react';
import { AGENCY_RAIL_COPY as COPY } from '../../lib/v2/copy/agency';
import type { ActionView } from '../../lib/v2/view/account-actions';
import type { SwitcherView } from '../../lib/v2/view/account-shell';
import { useLive } from './screens/account/LiveActions';
import { VisuallyHidden } from './VisuallyHidden';
import styles from './AccountSwitcher.module.css';

/**
 * One switch: a form that posts the account's id. `spoken` is read before the label by a screen
 * reader where the label is the account's name alone.
 */
function Switch({
  to,
  live,
  className,
  spoken,
}: {
  to: ActionView;
  live: boolean;
  className: string | undefined;
  spoken?: string;
}) {
  return (
    <form
      method="post"
      action={to.href}
      // A preview switches nothing, as its other forms post nothing (ActionControl).
      onSubmit={live ? undefined : (e: FormEvent) => e.preventDefault()}
    >
      {Object.entries(to.fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" className={className}>
        {spoken ? <VisuallyHidden>{`${spoken} `}</VisuallyHidden> : null}
        {to.label}
      </button>
    </form>
  );
}

/** The person's other accounts: each a form that posts its id to the switch. */
function Others({ switcher, live }: { switcher: SwitcherView; live: boolean }) {
  return (
    <>
      <p className={styles.caption} aria-hidden="true">
        {COPY.switchTo}
      </p>
      <ul className={styles.list}>
        {switcher.others.map((o) => (
          <li key={o.fields.accountId}>
            <Switch to={o} live={live} className={styles.item} spoken={COPY.switchTo} />
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * On a page of an account the reader is not acting in: which account the page shows, which one
 * they act in, and the one switch, to the account shown. No list: the page's own account is the
 * only one that makes this page's rail true.
 */
function Visiting({
  current,
  visiting,
  live,
}: {
  current: string;
  visiting: NonNullable<SwitcherView['visiting']>;
  live: boolean;
}) {
  return (
    <div className={styles.switcher} data-v2-account-switcher="visiting">
      <p className={styles.shown}>
        <VisuallyHidden>{`${COPY.acting}: `}</VisuallyHidden>
        {current}
      </p>
      <p className={styles.caption}>{COPY.actingIn(visiting.acting)}</p>
      <Switch to={visiting.switchTo} live={live} className={styles.trigger} />
    </div>
  );
}

/**
 * The rail's account switcher, for a person with seats on several accounts: the account acted in,
 * on a button that says whether the list of the others is shown (`aria-expanded`), and that list.
 * A disclosure, as NavMenu is: Escape closes it and hands focus back to the button when focus was
 * in it or on nothing; a press outside it, or focus moving to an element outside it, closes it too.
 * The list opens in the rail's own column, under the button, so it covers nothing.
 *
 * Where script does not run, the `<noscript>` copy of the list is what a reader gets: open, its
 * forms posting as any form does.
 *
 * On a page of an account the reader is not acting in (`switcher.visiting`) it is not a
 * disclosure: it says so and offers the one switch, to the account the page shows.
 */
export function AccountSwitcher({
  switcher,
  defaultOpen = false,
}: {
  switcher: SwitcherView;
  /** The list shown from the start: a preview of the open state. A page opens with it closed. */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const live = useLive();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const press = (e: Event) => {
      if (e.target instanceof Node && root.current?.contains(e.target)) return;
      setOpen(false);
    };
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

  const onBlur = (e: FocusEvent) => {
    const next = e.relatedTarget;
    if (next instanceof Node && !root.current?.contains(next)) setOpen(false);
  };

  if (switcher.visiting) {
    return <Visiting current={switcher.current} visiting={switcher.visiting} live={live} />;
  }
  return (
    <div ref={root} className={styles.switcher} data-v2-account-switcher="" onBlur={onBlur}>
      <button
        ref={button}
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <VisuallyHidden>{`${COPY.acting}: `}</VisuallyHidden>
        <span className={styles.name}>{switcher.current}</span>
        {/* The open-or-closed cue of a disclosure button: it marks a state (rule 10). */}
        <svg className={styles.chevron} viewBox="0 0 10 6" aria-hidden="true" focusable="false">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      <div id={id} className={styles.panel} hidden={!open}>
        <Others switcher={switcher} live={live} />
      </div>
      <noscript>
        <div className={styles.panel}>
          <Others switcher={switcher} live />
        </div>
      </noscript>
    </div>
  );
}

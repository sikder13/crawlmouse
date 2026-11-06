import type { ReactNode } from 'react';
import { BrandLink } from './BrandLink';
import shell from './PageShell.module.css';
import styles from './AccountShell.module.css';

export interface RailLink {
  label: string;
  href: string;
  /** "5", "3 new"; null shows no count. */
  count: string | null;
  /** The page this is (`aria-current="page"`). */
  current: boolean;
}

export interface AccountShellProps {
  /** The rail's links, in order. */
  nav: RailLink[];
  /** The plan card under the links (the trial card), or nothing. */
  card?: ReactNode;
  /** The theme row at the foot of the rail. */
  theme?: ReactNode;
  children: ReactNode;
}

/**
 * The signed-in frame: a rail of the account's pages beside the page itself (Final-Dashboard). It
 * shares PageShell's canvas, type and element defaults, and has no site header or footer. On a
 * phone the rail becomes a band across the top.
 */
export function AccountShell({ nav, card, theme, children }: AccountShellProps) {
  return (
    <div className={`${shell.shell} ${styles.frame}`} data-v2-shell="" data-v2-account-shell="">
      <aside className={styles.rail}>
        <BrandLink />
        <nav className={styles.nav} aria-label="Primary">
          {nav.map((l) => (
            <a
              key={l.label}
              href={l.href}
              className={l.current ? `${styles.link} ${styles.current}` : styles.link}
              aria-current={l.current ? 'page' : undefined}
            >
              {l.label}
              {l.count ? <span className={styles.count}>{l.count}</span> : null}
            </a>
          ))}
        </nav>
        {card ? <div className={styles.card}>{card}</div> : null}
        {theme ? <div className={styles.theme}>{theme}</div> : null}
      </aside>
      <main className={styles.main}>{children}</main>
    </div>
  );
}

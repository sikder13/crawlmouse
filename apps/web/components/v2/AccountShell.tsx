import type { ReactNode } from 'react';
import { BrandLink } from './BrandLink';
import shell from './PageShell.module.css';
import styles from './AccountShell.module.css';

export interface RailLink {
  label: string;
  href: string;
  /** "5", "3 new"; null shows no count. */
  count: string | null;
  /** The rail entry this page is, or belongs to (`aria-current`). */
  current: boolean;
  /** The count names new things, drawn in the text colour rather than muted (Final-Dashboard). */
  fresh: boolean;
}

export interface AccountShellProps {
  /** The rail's links, in order. */
  nav: RailLink[];
  /** The plan card under the links (the trial card), or nothing. */
  card?: ReactNode;
  /** The theme row at the foot of the rail. */
  theme?: ReactNode;
  /**
   * `page` when this page is the rail entry itself (/dashboard); `location` when it sits under it
   * (a site page, under Sites).
   */
  currentIs?: 'page' | 'location';
  children: ReactNode;
}

/**
 * The signed-in frame: a rail of the account's pages beside the page itself (Final-Dashboard). It
 * shares PageShell's canvas, type and element defaults, and has no site header or footer. On a
 * phone the rail becomes a band across the top.
 */
export function AccountShell({
  nav,
  card,
  theme,
  currentIs = 'page',
  children,
}: AccountShellProps) {
  return (
    <div className={`${shell.shell} ${styles.frame}`} data-v2-shell="" data-v2-account-shell="">
      <a href="#account-main" className={styles.skip} data-v2-sr-only="">
        Skip to the page
      </a>
      <div className={styles.rail}>
        <BrandLink />
        <nav className={styles.nav} aria-label="Primary">
          {nav.map((l) => (
            <a
              key={l.label}
              href={l.href}
              className={l.current ? `${styles.link} ${styles.current}` : styles.link}
              aria-current={l.current ? currentIs : undefined}
            >
              {l.label}
              {l.count ? (
                <>
                  {' '}
                  <span className={l.fresh ? `${styles.count} ${styles.fresh}` : styles.count}>
                    {l.count}
                  </span>
                </>
              ) : null}
            </a>
          ))}
        </nav>
        {card ? <div className={styles.card}>{card}</div> : null}
        {theme ? <div className={styles.theme}>{theme}</div> : null}
      </div>
      <main id="account-main" className={styles.main}>
        {children}
      </main>
    </div>
  );
}

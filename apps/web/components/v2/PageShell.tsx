import type { ReactNode } from 'react';
import { BrandLink } from './BrandLink';
import { NavMenu } from './NavMenu';
import { SiteFooter, type ServiceStatus } from './SiteFooter';
import { isGroup, type NavEntry } from './footer-links';
import layout from './layout.module.css';
import styles from './PageShell.module.css';

export interface PageShellProps {
  /** `marketing`: 72px header, no rule. `app`: 64px header with a hairline under it. */
  header?: 'marketing' | 'app';
  /**
   * Links, and groups that open as a menu (NavMenu). The marketing header's entries are
   * MARKETING_NAV in footer-links.ts; a planned entry renders as text.
   */
  nav?: NavEntry[];
  /** Buttons at the right of the header. */
  actions?: ReactNode;
  footer?: boolean;
  /** What the footer's Status link shows (SiteFooter); the shell fetches nothing. */
  status?: ServiceStatus;
  children: ReactNode;
}

function NavItem({ entry }: { entry: NavEntry }) {
  if (isGroup(entry)) return <NavMenu group={entry} />;
  if (entry.planned) {
    return (
      <span className={styles.planned} data-v2-planned="">
        {entry.label}
      </span>
    );
  }
  return <a href={entry.href}>{entry.label}</a>;
}

/** The page frame: canvas colours, the header with the brand, and the footer. */
export function PageShell({
  header = 'marketing',
  nav,
  actions,
  footer = true,
  status,
  children,
}: PageShellProps) {
  return (
    <div className={styles.shell} data-v2-shell="">
      <header className={`${styles.header} ${styles[header]}`}>
        <div className={`${layout.wrap} ${layout.row} ${styles.bar}`}>
          <BrandLink />
          {nav && nav.length ? (
            <nav className={`${layout.row} ${styles.nav}`} aria-label="Primary">
              {nav.map((entry) => (
                <NavItem key={entry.label} entry={entry} />
              ))}
            </nav>
          ) : null}
          {actions ? <div className={`${layout.row} ${styles.actions}`}>{actions}</div> : null}
        </div>
      </header>
      {children}
      {footer ? <SiteFooter status={status} /> : null}
    </div>
  );
}

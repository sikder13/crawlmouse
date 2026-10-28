import type { ReactNode } from 'react';
import { CrawlmouseMark } from '../icons/CrawlmouseMark';
import layout from './layout.module.css';
import styles from './PageShell.module.css';

export interface NavLink {
  label: string;
  href: string;
}

export interface PageShellProps {
  /** `marketing`: 72px header, no rule. `app`: 64px header with a hairline under it. */
  header?: 'marketing' | 'app';
  nav?: NavLink[];
  /** Buttons at the right of the header. */
  actions?: ReactNode;
  footer?: boolean;
  footerLinks?: NavLink[];
  children: ReactNode;
}

const FOOTER_LINKS: NavLink[] = [
  { label: 'Docs', href: '#' },
  { label: 'Status', href: '/status' },
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms', href: '/terms' },
  { label: 'support@crawlmouse.com', href: 'mailto:support@crawlmouse.com' },
];

/** The brand: the CrawlmouseMark and the crawl + orange mouse wordmark, linking home. */
export function BrandLink() {
  return (
    <a href="/" className={styles.brand} aria-label="Crawlmouse home">
      <CrawlmouseMark size={24} className={styles.mark} />
      <span className={styles.wordmark} data-v2-wordmark="">
        crawl<span className={styles.wordmarkMouse}>mouse</span>
      </span>
    </a>
  );
}

/** The page frame: canvas colours, the header with the brand, and the footer. */
export function PageShell({
  header = 'marketing',
  nav,
  actions,
  footer = true,
  footerLinks = FOOTER_LINKS,
  children,
}: PageShellProps) {
  return (
    <div className={styles.shell} data-v2-shell="">
      <header className={`${styles.header} ${styles[header]}`}>
        <div className={`${layout.wrap} ${layout.row} ${styles.bar}`}>
          <BrandLink />
          {nav && nav.length ? (
            <nav className={`${layout.row} ${styles.nav}`} aria-label="Primary">
              {nav.map((l) => (
                <a key={l.label} href={l.href}>
                  {l.label}
                </a>
              ))}
            </nav>
          ) : null}
          {actions ? <div className={`${layout.row} ${styles.actions}`}>{actions}</div> : null}
        </div>
      </header>
      {children}
      {footer ? (
        <footer className={styles.footer}>
          <div className={`${layout.wrap} ${styles.footerBar}`}>
            <span className={layout.mut}>Nahl Technologies Inc. · Indianapolis</span>
            <nav className={`${layout.row} ${styles.footerNav}`} aria-label="Footer">
              {footerLinks.map((l) => (
                <a key={l.label} href={l.href}>
                  {l.label}
                </a>
              ))}
            </nav>
          </div>
        </footer>
      ) : null}
    </div>
  );
}

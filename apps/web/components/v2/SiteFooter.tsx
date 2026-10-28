import { BrandLink } from './BrandLink';
import { CookieSettings } from './CookieSettings';
import { CopyEmail } from './CopyEmail';
import { Glyph } from './StatusPill';
import { VisuallyHidden } from './VisuallyHidden';
import { FOOTER_COLUMNS, FOOTER_COPY, SUPPORT_EMAIL, type FooterItem } from './footer-links';
import type { PillState } from './pill-states';
import layout from './layout.module.css';
import styles from './SiteFooter.module.css';

export type ServiceStatus = 'ok' | 'degraded' | 'down';

/**
 * Rule 7: status is colour plus shape, so the Status link's "dot" is the status glyph. With no
 * status given it is a muted ring, the shape for "not known", and nothing is said about it.
 */
const STATUS: Record<ServiceStatus | 'unknown', { shape: PillState; spoken: string | null }> = {
  ok: { shape: 'ok', spoken: 'operational' },
  degraded: { shape: 'warn', spoken: 'degraded' },
  down: { shape: 'bad', spoken: 'down' },
  unknown: { shape: 'unverified', spoken: null },
};

export interface SiteFooterProps {
  /**
   * What the Status link shows. The page passes it in; the footer fetches nothing. Absent, the
   * shape is muted.
   */
  status?: ServiceStatus;
}

function FooterEntry({ item, status }: { item: FooterItem; status?: ServiceStatus }) {
  if ('control' in item) return <CookieSettings label={item.label} />;
  if (item.planned) {
    return (
      <span className={styles.planned} data-v2-planned="">
        {item.label}
      </span>
    );
  }
  if ('showsStatus' in item) {
    const key = status ?? 'unknown';
    const { shape, spoken } = STATUS[key];
    return (
      <a href={item.href} className={styles.status} data-v2-status={key}>
        {item.label}
        <Glyph state={shape} className={`${styles.glyph} ${styles[shape]}`} />
        {spoken ? <VisuallyHidden>{`: ${spoken}`}</VisuallyHidden> : null}
      </a>
    );
  }
  return <a href={item.href}>{item.label}</a>;
}

/** The site footer: the brand block, and the four columns of links from footer-links.ts. */
export function SiteFooter({ status }: SiteFooterProps) {
  return (
    <footer className={styles.footer} data-v2-footer="">
      <div className={`${layout.wrap} ${styles.grid}`}>
        <div className={styles.brand} data-v2-footer-brand="">
          <BrandLink />
          <p className={styles.line}>{FOOTER_COPY.line}</p>
          <p className={layout.mut}>{FOOTER_COPY.company}</p>
          <CopyEmail address={SUPPORT_EMAIL} />
          <p className={layout.mut}>
            © <span data-v2-year="">{new Date().getFullYear()}</span>
          </p>
        </div>
        <nav className={styles.columns} aria-label="Footer">
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title} data-v2-footer-column="">
              <h2 className={styles.title}>{column.title}</h2>
              <ul className={styles.list}>
                {column.items.map((item) => (
                  <li key={item.label}>
                    <FooterEntry item={item} status={status} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
    </footer>
  );
}

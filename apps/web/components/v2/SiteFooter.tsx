import type { ReactNode } from 'react';
import { BrandLink } from './BrandLink';
import { CookieSettings } from './CookieSettings';
import { CopyEmail } from './CopyEmail';
import { Glyph } from './StatusPill';
import { VisuallyHidden } from './VisuallyHidden';
import { checksPublicEnabled } from '../../lib/auth/flags';
import { FOOTER_LINE_CAPABILITIES } from '../../lib/v2/copy/footer-line';
import {
  FOOTER_COLUMNS,
  FOOTER_COPY,
  SUPPORT_EMAIL,
  type FooterGates,
  type FooterItem,
} from './footer-links';
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

/**
 * The footer's gates as this process's environment sets them. Read on the server; a client page
 * cannot read the server's flags, so it passes its own (PageShell `footerGates`).
 */
export function footerGates(): FooterGates {
  return { checksPublic: checksPublicEnabled() };
}

export interface SiteFooterProps {
  /**
   * What the Status link shows. The page passes it in; the footer fetches nothing. Absent, or a
   * value outside the three, the shape is muted.
   */
  status?: ServiceStatus;
  /** Shown after the footer's line: a page's "coming" mark for what the line names. */
  lineMark?: ReactNode;
  /** Which gated entries are links; absent, `footerGates()`. */
  gates?: FooterGates;
}

function FooterEntry({
  item,
  status,
  gates,
}: {
  item: FooterItem;
  status?: ServiceStatus;
  gates: FooterGates;
}) {
  if ('control' in item) return <CookieSettings label={item.label} />;
  if (item.planned || ('gate' in item && !gates[item.gate])) {
    return (
      <span className={styles.planned} data-v2-planned="">
        {item.label}
      </span>
    );
  }
  if ('showsStatus' in item) {
    // The type stops nothing at run time: a value fed from a status source and cast, or a
    // prototype key such as "constructor", falls back to unknown instead of throwing out of the
    // render.
    const key = status && Object.hasOwn(STATUS, status) ? status : 'unknown';
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
export function SiteFooter({ status, lineMark, gates = footerGates() }: SiteFooterProps) {
  return (
    <footer className={styles.footer} data-v2-footer="">
      <div className={`${layout.wrap} ${styles.grid}`}>
        <div className={styles.brand} data-v2-footer-brand="">
          <BrandLink />
          <p className={styles.line} data-capability={FOOTER_LINE_CAPABILITIES.join(' ')}>
            {FOOTER_COPY.line}
            {lineMark ? <> {lineMark}</> : null}
          </p>
          <p className={layout.mut}>{FOOTER_COPY.company}</p>
          <CopyEmail address={SUPPORT_EMAIL} />
          {/* The year when the page renders; on a page built statically, the year of the build. */}
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
                    <FooterEntry item={item} status={status} gates={gates} />
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

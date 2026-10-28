'use client';

import { CONSENT_OPEN_EVENT } from '../../lib/consent';
import styles from './SiteFooter.module.css';

/**
 * Re-opens the consent banner, so a visitor can change or withdraw an analytics decision (GDPR
 * Art. 7(3): withdrawing as easy as giving). The same event as the live footer's control; styled
 * as a footer link, without the live control's orange hover (rule 3).
 */
export function CookieSettings({ label = 'Cookie settings' }: { label?: string }) {
  return (
    <button
      type="button"
      className={styles.control}
      onClick={() => window.dispatchEvent(new Event(CONSENT_OPEN_EVENT))}
    >
      {label}
    </button>
  );
}

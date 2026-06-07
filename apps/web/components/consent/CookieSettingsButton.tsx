'use client';
import { CONSENT_OPEN_EVENT } from '@/lib/consent';

/**
 * Persistent footer control that re-opens the consent banner so a visitor can change or withdraw a
 * prior analytics-consent decision (GDPR Art. 7(3): withdrawal as easy as giving). Available on
 * every page via the Footer, for visitors in every region.
 */
export function CookieSettingsButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(CONSENT_OPEN_EVENT))}
      className="block text-left hover:text-peach"
    >
      Cookie settings
    </button>
  );
}

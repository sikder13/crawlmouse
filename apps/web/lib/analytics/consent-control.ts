import type { PostHog } from 'posthog-js';
import { clearAnalyticsStorage } from '../consent';
import { hasSessionCookie } from '../v2/session-header';

/** The browser's two stores, each read when it is used: reading one can throw (lib/consent.ts). */
export const BROWSER_STORES: readonly (() => Storage)[] = [
  () => window.localStorage,
  () => window.sessionStorage,
];

/** The support console, where the browser's analytics never run (owner ruling, CC-33). */
export const onSupportConsole = (pathname: string = window.location.pathname): boolean =>
  /^\/internal(\/|$)/.test(pathname);

/**
 * What opting out leaves able to send, each with its own switch in posthog-js 1.376.0: `/flags/`,
 * which the SDK's refresh timer and `reset()` still call with the visitor's ids; the add-on scripts a
 * remote config arriving after the decline would fetch; and surveys, product tours and conversations.
 * These switches stop new loads. A conversations widget already polling is stopped by its `reset()`.
 */
const OFF_AFTER_DECLINE = {
  advanced_disable_flags: true,
  disable_external_dependency_loading: true,
  disable_surveys: true,
  disable_product_tours: true,
  disable_conversations: true,
} as const;

/**
 * A decline, on this tab or another: capture stops, what `OFF_AFTER_DECLINE` names and persistence go
 * off, and what analytics stored is removed. With opted-out as the SDK's default, removing its own
 * opt-out key does not turn it back on. Before PostHog has started the SDK is not called, because its
 * opt-out writes to storage. An event already queued when the visitor declined was captured with
 * their consent and may still go.
 */
export function stopAnalytics(
  posthog: Pick<PostHog, '__loaded' | 'opt_out_capturing' | 'set_config' | 'conversations'>,
) {
  if (posthog.__loaded) {
    posthog.opt_out_capturing();
    posthog.set_config({
      ...OFF_AFTER_DECLINE,
      disable_persistence: true,
      opt_out_capturing_by_default: true,
    });
    posthog.conversations?.reset();
  }
  clearAnalyticsStorage(document, BROWSER_STORES);
}

/**
 * A grant on a page where PostHog already runs. Where it has not started, the grant event starts it.
 * On the support console nothing is turned back on, since opting in itself sends an event.
 */
export function resumeAnalytics(
  posthog: Pick<PostHog, '__loaded' | 'opt_in_capturing' | 'set_config'>,
) {
  if (!posthog.__loaded || onSupportConsole()) return;
  posthog.set_config({
    disable_persistence: false,
    opt_out_capturing_by_default: false,
    advanced_disable_flags: false,
    disable_external_dependency_loading: false,
    // The one survey is the account shell's Feedback: a signed-out page has no use for its script.
    disable_surveys: !hasSessionCookie(document.cookie),
    disable_product_tours: false,
    disable_conversations: false,
  });
  posthog.opt_in_capturing();
}

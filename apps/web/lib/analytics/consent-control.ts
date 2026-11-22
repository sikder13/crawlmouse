import type { PostHog } from 'posthog-js';
import { clearAnalyticsStorage } from '../consent';

/** The browser's two stores, each read when it is used: reading one can throw (lib/consent.ts). */
export const BROWSER_STORES: readonly (() => Storage)[] = [
  () => window.localStorage,
  () => window.sessionStorage,
];

/**
 * A decline, on this tab or another: capture stops, surveys and persistence go off, and what analytics
 * stored is removed. With opted-out as the SDK's default, removing its own opt-out key does not turn it
 * back on. Before PostHog has started the SDK is not called, because its opt-out writes to storage.
 * An event already queued when the visitor declined was captured with their consent and may still go.
 */
export function stopAnalytics(
  posthog: Pick<PostHog, '__loaded' | 'opt_out_capturing' | 'set_config'>,
) {
  if (posthog.__loaded) {
    posthog.opt_out_capturing();
    posthog.set_config({
      disable_surveys: true,
      disable_persistence: true,
      opt_out_capturing_by_default: true,
    });
  }
  clearAnalyticsStorage(document, BROWSER_STORES);
}

/** A grant on a page where PostHog already runs. Where it has not started, the grant event starts it. */
export function resumeAnalytics(
  posthog: Pick<PostHog, '__loaded' | 'opt_in_capturing' | 'set_config'>,
) {
  if (!posthog.__loaded) return;
  posthog.set_config({
    disable_persistence: false,
    opt_out_capturing_by_default: false,
    disable_surveys: false,
  });
  posthog.opt_in_capturing();
}

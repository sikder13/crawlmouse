'use client';
import posthog from 'posthog-js';
import type { CaptureResult } from 'posthog-js';
import type { FunnelEvent } from './analytics-events';
import { shouldSendEvent } from './analytics-sampling';

/**
 * PostHog `before_send` hook — drops sampled high-volume events (cost control #6) before they
 * leave the browser. Typed to PostHog's own `CaptureResult | null` so it satisfies the SDK's
 * `before_send` signature when assigned in `instrumentation-client.ts`.
 */
export function beforeSendSampler(cr: CaptureResult | null): CaptureResult | null {
  if (!cr) return cr;
  return shouldSendEvent(cr.event, Math.random()) ? cr : null;
}

/** Typed funnel tracker — names constrained to the seven funnel events. */
export function track(event: FunnelEvent, props?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  posthog.capture(event, props);
}

/** Escape hatch for non-funnel custom events (rare). */
export function trackRaw(event: string, props?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  posthog.capture(event, props);
}

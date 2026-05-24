'use client';
import posthog from 'posthog-js';

export function initAnalytics() {
  if (typeof window === 'undefined') return;
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
  if ((posthog as unknown as { __initialized?: boolean }).__initialized) return;
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
    person_profiles: 'always',
    capture_pageview: true,
    capture_pageleave: true,
  });
  (posthog as unknown as { __initialized?: boolean }).__initialized = true;
}

export function track(event: string, props?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  posthog.capture(event, props);
}

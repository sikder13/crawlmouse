/**
 * Hosts whose CSP reports Sentry drops at ingest (Sentry CRAWLMOUSE-S): scripts an in-app browser
 * injects into the pages it shows, which our policy never loads. Facebook's in-app browser on iOS
 * injects `connect.facebook.net/en_US/pcm.js`, and the report-only policy reports it on every page.
 *
 * This list does not reach Sentry by itself. It is copied by hand into Sentry's Project Settings ›
 * Security Headers › CSP › Additional ignored sources, as `docs/ops/security-baseline.md` says; the
 * test pins that the document names each entry. The policy is not widened: no entry is a host it
 * allows, which is pinned too.
 */
export const CSP_IGNORED_SOURCES = ['connect.facebook.net'] as const;

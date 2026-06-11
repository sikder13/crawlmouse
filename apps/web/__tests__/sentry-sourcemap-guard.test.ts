import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import config, { sentryBuildOptions } from '../next.config.mjs';

// Guard for the build-time Sentry source-map / release invariant.
//
// Runtime Sentry.init() (server + client) only CAPTURES errors; it does NOT make their stack traces
// readable. Next.js minifies the production bundle, so a prod 5xx lands in Sentry as a minified,
// un-actionable trace UNLESS source maps are uploaded at build time. The ONLY supported way to upload
// them for @sentry/nextjs is to wrap next.config with `withSentryConfig` (the wrapper injects the
// Sentry build plugin, which uploads maps + creates the release using SENTRY_AUTH_TOKEN). Setting
// SENTRY_AUTH_TOKEN alone does nothing without this wrapper.
//
// next.config.mjs exports the plugin options as `sentryBuildOptions` so these assertions check the
// REAL resolved JS values — robust against source-text spellings (quoted keys, truthy non-literals,
// comments) that a substring-regex guard cannot defend against.
const WEB_DIR = resolve(__dirname, '..');

function readConfigSource(): string {
  const source = readFileSync(resolve(WEB_DIR, 'next.config.mjs'), 'utf8');
  expect(source.trim().length, 'next.config.mjs is empty or whitespace-only').toBeGreaterThan(0);
  return source;
}

describe('Sentry source-map upload invariant (next.config.mjs)', () => {
  it('wraps the default-exported config with withSentryConfig (else no source maps upload)', () => {
    const cfg = readConfigSource();
    expect(
      /import\s*\{[^}]*\bwithSentryConfig\b[^}]*\}\s*from\s*['"]@sentry\/nextjs['"]/.test(cfg),
      'next.config must import { withSentryConfig } from "@sentry/nextjs"',
    ).toBe(true);
    expect(
      /export\s+default\s+withSentryConfig\s*\(\s*nextConfig\s*,\s*sentryBuildOptions\s*\)/.test(cfg),
      'the default export must be withSentryConfig(nextConfig, sentryBuildOptions)',
    ).toBe(true);
  });

  it('actually applies withSentryConfig (catches a shadowed identity passthrough)', () => {
    // A call-site that LOOKS wrapped can still be defeated by shadowing the import with an identity
    // fn (`const withSentryConfig = (c) => c`), leaving the plugin un-applied and uploading nothing.
    // The real wrapper injects build markers into the RESOLVED config (env._sentryRelease /
    // env._sentryRewriteFramesDistDir, experimental.clientTraceMetadata). Assert one is present, so a
    // bypassed wrapper fails behaviorally regardless of the call-site text.
    const env = (config as { env?: Record<string, unknown> }).env ?? {};
    expect(
      Object.keys(env).some((k) => k.startsWith('_sentry')),
      'withSentryConfig did not actually run (no _sentry* markers in the resolved config — wrapper bypassed?)',
    ).toBe(true);
  });

  it('targets the correct Sentry org + project (else uploads go nowhere / fail)', () => {
    expect(sentryBuildOptions.org).toBe('nahl-technologies-inc');
    expect(sentryBuildOptions.project).toBe('crawlmouse');
  });

  it('reads the auth token from the environment, never a hard-coded literal', () => {
    // Value: the option is wired to exactly the env var (whatever its value, incl. undefined locally).
    expect(sentryBuildOptions.authToken).toBe(process.env.SENTRY_AUTH_TOKEN);
    // Source: never commit a real token. sntrys_ = org token, sntryu_ = user token.
    expect(/sntrys_|sntryu_/.test(readConfigSource()), 'next.config must not contain a hard-coded Sentry token').toBe(false);
  });

  it('uploads a complete client map set (widenClientFileUpload)', () => {
    expect(sentryBuildOptions.widenClientFileUpload).toBe(true);
  });

  it('does not leave source maps publicly served (deleteSourcemapsAfterUpload)', () => {
    expect(sentryBuildOptions.sourcemaps?.deleteSourcemapsAfterUpload).toBe(true);
  });

  it('never disables the plugin or source-map upload (value-checked, bypass-proof)', () => {
    // Evaluating the real value defeats every source-text evasion (quoted key `\'disable\'`, truthy
    // non-literal `!!1`, a ternary, etc.): all collapse to a truthy value here. A `disable: true` at
    // the top level kills the whole plugin; inside `sourcemaps` it kills upload — both revert prod to
    // minified traces while every other knob looks fine. `disable` is intentionally absent from the
    // committed options, so widen the (compile-time only) type to read the runtime value either way.
    const opts = sentryBuildOptions as unknown as { disable?: unknown; sourcemaps?: { disable?: unknown } };
    expect(opts.disable, 'top-level plugin disable must be falsy').toBeFalsy();
    expect(opts.sourcemaps?.disable, 'sourcemaps.disable must be falsy').toBeFalsy();
  });

  it('keeps the errorHandler non-fatal: it logs and does not throw (behavioral)', () => {
    expect(typeof sentryBuildOptions.errorHandler).toBe('function');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // A re-throwing / process.exit handler would make a Sentry/CI/token hiccup fail the deploy —
      // the opposite of the intent. Call with VARIED shapes (not one fixed fixture) so a handler that
      // tolerates only a specific error (e.g. keyed on a message string) cannot pass while re-throwing
      // on real errors.
      const inputs: unknown[] = [
        new Error('boom'),
        new Error(''),
        new TypeError('type'),
        Object.assign(new Error('with-code'), { code: 'ENOENT' }),
        'a string error',
        { message: 'plain object' },
        undefined,
      ];
      for (const e of inputs) {
        expect(() => sentryBuildOptions.errorHandler?.(e as Error), `errorHandler threw on ${String(e)}`).not.toThrow();
      }
    } finally {
      warn.mockRestore();
    }
  });

  it('does not phone home Sentry plugin telemetry', () => {
    expect(sentryBuildOptions.telemetry).toBe(false);
  });
});

// instrumentation.ts already wires Sentry.captureRequestError (server-side RSC / route-handler 5xx).
// The App Router's CLIENT-side React render errors (a crash in the root layout/template) are only
// reported if app/global-error.tsx exists and reports to Sentry — otherwise those errors are
// invisible in prod. This guard pins that file + its Sentry wiring. Comments are stripped first so a
// doc-comment can't satisfy a code-shape assertion (comment-blindness).
describe('Sentry global error handler (app/global-error.tsx)', () => {
  function readGlobalError(): string {
    let source = readFileSync(resolve(WEB_DIR, 'app/global-error.tsx'), 'utf8');
    expect(source.trim().length, 'app/global-error.tsx is empty or whitespace-only').toBeGreaterThan(0);
    // Strip block + line comments so commented-out code / doc-comments don't satisfy the regexes.
    source = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    return source;
  }

  it('exists as a Client Component', () => {
    const src = readGlobalError();
    expect(/^\s*['"]use client['"]/m.test(src), 'global-error must declare the "use client" directive').toBe(true);
  });

  it('reports the error to Sentry', () => {
    const src = readGlobalError();
    expect(/from\s*['"]@sentry\/nextjs['"]/.test(src), 'global-error must import @sentry/nextjs').toBe(true);
    expect(
      /Sentry\.captureException\s*\(\s*error\s*\)/.test(src),
      'global-error must call Sentry.captureException(error) so client render errors reach Sentry',
    ).toBe(true);
  });

  it('runs captureException from inside the useEffect (not dead code outside the effect)', () => {
    const src = readGlobalError();
    expect(
      /useEffect\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?Sentry\.captureException\(\s*error\s*\)[\s\S]*?\}\s*,\s*\[/.test(src),
      'Sentry.captureException(error) must execute inside the useEffect',
    ).toBe(true);
  });

  it('renders its own <html> and <body> (a global-error replaces the crashed root layout)', () => {
    const src = readGlobalError();
    expect(/<html\b/.test(src), 'global-error must render <html>').toBe(true);
    expect(/<body\b/.test(src), 'global-error must render <body>').toBe(true);
  });
});

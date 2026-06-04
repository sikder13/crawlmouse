import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Source-text guard for the session-replay privacy posture in instrumentation-client.ts. That
// module runs posthog.init / Sentry.init at IMPORT time, so we cannot import it to read the options
// without firing the SDKs in a jsdom-less unit env; instead we pin the exact option literals from
// the source (same approach as load-harness-guard.test.ts). Comments are stripped first so a
// weakened real option hidden behind a reassuring comment cannot satisfy the assertion. Each value
// is pinned WITH its trailing delimiter so a relaxation (e.g. `0` -> `0.5`, `true` -> `false`)
// cannot still match as a substring.
const FILE = resolve(__dirname, '..', 'instrumentation-client.ts');

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // line comments (avoid eating `://`)
}

const source = stripComments(readFileSync(FILE, 'utf8'));

describe('instrumentation-client replay privacy', () => {
  it('keeps Sentry replay error-only (no session sampling)', () => {
    expect(source).toContain('replaysSessionSampleRate: 0,');
    expect(source).toContain('replaysOnErrorSampleRate: 1.0,');
  });

  it('keeps PostHog recording off-by-default with input masking', () => {
    expect(source).toContain('disable_session_recording: true,');
    expect(source).toContain('maskAllInputs: true,');
    expect(source).toContain("maskTextSelector: '[data-ph-mask]'");
  });

  it('starts replay ONLY from the error / unhandledrejection handlers', () => {
    // Exactly one startSessionRecording call site, wrapped by startReplay and bound to BOTH error
    // listeners — never an unconditional start that would record healthy sessions.
    const starts = source.match(/startSessionRecording\s*\(/g) ?? [];
    expect(starts.length).toBe(1);
    expect(source).toContain('const startReplay');
    expect(source).toContain("addEventListener('error', startReplay");
    expect(source).toContain("addEventListener('unhandledrejection', startReplay");
  });
});

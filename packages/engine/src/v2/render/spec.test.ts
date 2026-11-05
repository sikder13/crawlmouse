import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderRenderSpec, SPEC_URL } from './spec.js';

describe('docs/specs/v2/14-render.md', () => {
  it('is exactly what the code renders it to', () => {
    expect(readFileSync(SPEC_URL, 'utf8')).toBe(renderRenderSpec());
  });
});

describe('the claim that sub-requests are checked one by one in our process', () => {
  // Browser Run's REST endpoint cannot call our code per request (ruling R1). The spec says so once;
  // nothing in the module or the spec may say the opposite.
  const CLAIM =
    /(?:every|each|all) sub-?requests? (?:goes|go|passes|pass|is|are) (?:through|checked by|sent to) (?:admitTargetUrl|admission|our (?:check|process)|(?:request )?interception)/i;
  const DIR = new URL('./', import.meta.url);
  const files = ['admission.ts', 'client.ts', 'policy.ts', 'run.ts', 'spec.ts'];

  it.each(files)('is not made in %s', (f) => {
    expect(readFileSync(new URL(f, DIR), 'utf8')).not.toMatch(CLAIM);
  });

  it('is not made in the spec, which says the opposite', () => {
    const spec = renderRenderSpec();
    expect(spec).not.toMatch(CLAIM);
    expect(spec).toContain('not by per-request interception in our process');
  });

  it('would be caught', () => {
    expect('Every sub-request goes through admitTargetUrl.').toMatch(CLAIM);
  });
});

describe('withdrawn claims', () => {
  // Sentences withdrawn after review, with the reason; none may come back in the module or the spec.
  const WITHDRAWN: [text: RegExp, why: string][] = [
    [
      /shows what a reader that runs no JavaScript gets/i,
      'inline scripts still run on the static side',
    ],
    [
      /the only thing that differs between the words/i,
      'inline scripts still run on the static side',
    ],
    [/never under-counted/i, 'a render can report more than any charge made for it'],
    [/which Cloudflare enforces/i, 'enforcement has not been observed'],
    [/holds each rule below to a test/i, 'Browser Run behaviour is held only by the live tests'],
    [/Fragments found only on challenge/i, 'a page quoting a marker is taken for a challenge'],
    [/It never throws for a page/i, 'replaced by what the code catches'],
  ];
  const DIR = new URL('./', import.meta.url);
  const texts = [
    ...readdirSync(DIR)
      .filter((f) => f.endsWith('.ts') && f !== 'spec.test.ts')
      .map((f) => [f, readFileSync(new URL(f, DIR), 'utf8')] as const),
    ['14-render.md', readFileSync(SPEC_URL, 'utf8')] as const,
    [
      'worker-runbook.md',
      readFileSync(new URL('../../../../../docs/ops/worker-runbook.md', import.meta.url), 'utf8'),
    ] as const,
  ];

  it.each(WITHDRAWN)('%s is gone (%s)', (text) => {
    expect(texts.filter(([, t]) => text.test(t)).map(([f]) => f)).toEqual([]);
  });

  it('reads the files it says it reads', () => {
    expect(texts.map(([f]) => f)).toContain('run.ts');
    expect(texts.length).toBeGreaterThan(10);
  });
});

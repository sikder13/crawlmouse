import { readFileSync } from 'node:fs';
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

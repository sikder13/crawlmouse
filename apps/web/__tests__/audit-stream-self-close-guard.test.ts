import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The audit SSE stream (/api/audits/[id]/stream) polls until the audit reaches a terminal status,
// with maxDuration=300. A stuck / never-completing audit would otherwise be truncated when Vercel
// kills the function at the ceiling, churning EventSource reconnects mid-write. The route must
// SELF-TERMINATE (with a `retry:` hint) before that ceiling. If this wiring is dropped, a stuck
// audit silently regresses to a hard runtime kill and no other test catches it — this guard does.
const ROUTE = resolve(__dirname, '..', 'app/api/audits/[id]/stream/route.ts');

function routeSrc(): string {
  // Strip comments so a commented-out self-close cannot satisfy the match.
  return readFileSync(ROUTE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('audit SSE stream self-termination', () => {
  it('uses the self-close budget and emits a retry hint before maxDuration', () => {
    const src = routeSrc();
    expect(
      /SSE_SELF_CLOSE_MS/.test(src),
      'route must use SSE_SELF_CLOSE_MS to self-terminate before the Vercel maxDuration kill',
    ).toBe(true);
    expect(
      /retry:/.test(src),
      'route must emit a `retry:` SSE hint so the client reconnects cleanly after a self-close',
    ).toBe(true);
  });

  it('still pins maxDuration to the proven 300s ceiling', () => {
    const m = routeSrc().match(/export\s+const\s+maxDuration\s*=\s*(\d+)/);
    expect(m, 'route must export const maxDuration').toBeTruthy();
    expect(Number(m![1])).toBe(300);
  });
});

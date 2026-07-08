import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SPEC 04 §13/§14 — the ?ref K-measurement only works if the capture lives on the pages that shared
// links LAND on. reportShareUrl builds `/r/<slug>?ref=…`, so ReferralCapture MUST be mounted on the
// report page (and the compare share surface), not only the homepage — else referral_landing never
// fires and K reads 0 forever. FAILS LOUD (ENOENT) on a rename.
const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

describe('referral capture is where shared links land (§13)', () => {
  it('shared links target the /r/ report page (so the capture there receives them)', () => {
    expect(read('lib/share-url.ts')).toContain('/r/'); // reportShareUrl builds /r/<slug>
  });

  it('ReferralCapture is mounted on the report page, the compare page, AND the homepage', () => {
    expect(read('app/r/[slug]/page.tsx')).toContain('ReferralCapture');
    expect(read('app/compare/[a]/[b]/page.tsx')).toContain('ReferralCapture');
    expect(read('app/page.tsx')).toContain('ReferralCapture');
  });
});

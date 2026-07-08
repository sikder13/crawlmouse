import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SPEC 04 §9 — "Hidden reports 404 publicly." Hide must be honored on EVERY public surface, not just
// the page: the OG card and the embed badge must not keep unfurling a hidden report's grade+domain.
// These are the exact surfaces the Stage B review found unguarded; pin that they now gate on hide.
// (The page itself is covered by report-visibility.test + the page's isReportGone gate.) FAILS LOUD
// (ENOENT) if a file is renamed.
const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

describe('hide is honored on every public surface (§9)', () => {
  it('the OG card gates its placeholder on isReportGone (covers hidden_at + takedown + null grade)', () => {
    const og = read('app/r/[slug]/opengraph-image.tsx');
    expect(og).toContain('isReportGone');
    // must NOT gate on takedown alone (the pre-fix bug that let a hidden report unfurl its grade)
    expect(og).not.toMatch(/if\s*\(\s*!report\s*\|\|\s*report\.takedown_requested_at\s*\)/);
  });

  it('the embed badge resolves a VISIBLE report (excludes hidden) via readLatestVisibleReport', () => {
    const badge = read('app/embed/[domain]/route.ts');
    expect(badge).toContain('readLatestVisibleReport');
  });

  it('the badge resolver filters hidden_at with a deploy-order-safe fallback', () => {
    const helper = read('lib/badge-report.ts');
    expect(helper).toContain("is('hidden_at', null)");
    expect(helper).toContain('isUndefinedColumnError'); // pre-migration fallback
  });
});

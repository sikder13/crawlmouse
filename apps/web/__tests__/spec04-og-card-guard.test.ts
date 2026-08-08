import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SPEC 04 §6 (V12) — the per-report OG card. It can't be unit-rendered (satori/ImageResponse returns a
// PNG), so this guard pins its contract: 1200×630, deterministic + CDN-cached, slug-scoped (never a free
// image-rendering endpoint), carries grade+domain+score, swaps to the white-label brand when set, and a
// GONE report unfurls the bare placeholder (noindex ≠ no-unfurl: the route still serves social crawlers).
// FAILS LOUD (ENOENT) on a rename.
// SPEC 5.1a Stage 4 moved the OG card's DECISION (gone-gating, white-label eyebrow, and the
// refusal to draw a grade slot without both a letter and a score) into lib/og-report-model.ts,
// so it could be unit-tested against a payload rather than grepped. A PNG route has no payload a
// test can read, which is why that extraction happened. These guards therefore read the route AND
// the model it delegates to: together they are the OG card's implementation, and the contract each
// asserts is unchanged.
const og =
  readFileSync(resolve(__dirname, '..', 'app/r/[slug]/opengraph-image.tsx'), 'utf8') +
  readFileSync(resolve(__dirname, '..', 'lib/og-report-model.ts'), 'utf8');

describe('per-report OG card contract (§6, V12)', () => {
  it('is 1200×630 and deterministically cached (a viral unfurl never re-runs satori per hit)', () => {
    expect(og).toMatch(/size\s*=\s*\{\s*width:\s*1200,\s*height:\s*630\s*\}/);
    expect(og).toMatch(/revalidate\s*=\s*3600/);
  });

  it('is slug-scoped — reads the report by slug, and a gone/missing report gets the placeholder', () => {
    expect(og).toContain('getPublicReport(slug)');
    expect(og).toContain('isReportGone');
  });

  it('carries grade + domain + score, and swaps to the white-label brand when set (§5)', () => {
    expect(og).toContain('report.grade');
    expect(og).toContain('report.domain');
    expect(og).toContain('report.score');
    expect(og).toContain('whiteLabelBrandName');
  });
});

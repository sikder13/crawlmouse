import { runAudit, formatCrawlHealth } from '@crawlmouse/engine';

function arg(name: string): string | undefined {
  const flag = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(flag));
  return found ? found.slice(flag.length) : undefined;
}

const url = arg('url') ?? process.argv[2];
if (!url) {
  console.error('Usage: pnpm smoke -- --url=https://example.com');
  process.exit(1);
}

const pageCap = Number(arg('pageCap') ?? 100);

console.log(`Auditing ${url} (page cap: ${pageCap})...`);
const start = Date.now();
const result = await runAudit({ url, pageCap, perHostConcurrency: 4, staggerMs: 250, pageTimeoutMs: 10000 });
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

console.log('\n=== Result ===');
console.log(`URL: ${result.url}`);
console.log(`CMS: ${result.cms} (confidence ${(result.cmsConfidence * 100).toFixed(0)}%)`);
console.log(`Pages: ${result.pages.length}`);
console.log(`Links: ${result.links.length}`);
console.log(`Grade: ${result.grade}  Score: ${result.score.toFixed(2)}/100`);
console.log(`Time: ${elapsed}s\n`);

const findingCounts = result.findings.reduce<Record<string, number>>((acc, f) => {
  acc[f.category] = (acc[f.category] ?? 0) + 1; return acc;
}, {});
console.log('Findings:');
for (const [cat, n] of Object.entries(findingCounts)) console.log(`  ${cat}: ${n}`);

// §6 crawl-health/confidence. Populated only on the v2 engine path (runAudit gates it on
// ENGINE_V2), so its presence here is also the local confirmation that ENGINE_V2=1 took effect
// in THIS shell — the Part-A pre-check for the Phase-1 cutover smoke.
if (result.crawlHealth) {
  console.log('\nCrawl-health (v2):');
  console.log(formatCrawlHealth(result.crawlHealth));
} else {
  console.log('\nCrawl-health: n/a (v1 engine — run with ENGINE_V2=1 to populate)');
}

// SPEC 02 §2 confidence band (v2). The point estimate is the REAL (uncapped) score; the band ±
// communicates crawl confidence; "based on N of ~M pages" is the honest coverage framing.
if (result.confidenceBand) {
  const b = result.confidenceBand;
  const ofM =
    b.basis.estimatedTotal != null
      ? `based on ${b.basis.crawled} of ~${b.basis.estimatedTotal} pages (method: ${b.basis.method})`
      : `based on ${b.basis.crawled} pages (no site-total estimate; method: ${b.basis.method})`;
  console.log('\nConfidence band (v2 §2):');
  console.log(`  Point estimate: ${b.grade} / ${b.pointEstimate.toFixed(2)}`);
  console.log(`  Band:           ${b.lower}–${b.upper}  (confidence: ${b.confidence})`);
  console.log(`  Framing:        ${b.isEstimate ? 'ESTIMATE (re-crawl recommended)' : 'VERDICT'} — ${ofM}`);
}

// SPEC 02 §3 projected-grade ledger (the gap): current → projected, with per-fix RELATIVE deltas
// (never summed — see the disclaimer). Free + full on v2; absent on v1 / JS-rendered.
if (result.projectedGrade) {
  const pg = result.projectedGrade;
  console.log('\nProjected grade (v2 §3) — the gap:');
  console.log(`  Current:   ${pg.current.grade} / ${pg.current.score.toFixed(2)}`);
  console.log(`  Projected: ${pg.projected.grade} / ${pg.projected.score.toFixed(2)}  (fix all ${pg.ledger.length} issues)`);
  console.log(`  Note: ${pg.disclaimer}`);
  console.log('  Top issues by marginal impact:');
  for (const f of pg.ledger.slice(0, 5)) {
    console.log(`    [+${f.marginalDelta.toFixed(2)}] ${f.category} (effort ${f.effort}) → ${f.targetUrl}`);
  }
}

// SPEC 02 §4/§5 the ONE free fix + its paste-ready action-packet (§5).
if (result.freeFix) {
  const ff = result.freeFix;
  console.log(`\nFree fix (v2 §4) — rank ${ff.rank}, marginal impact +${ff.diagnosis.marginalDelta.toFixed(2)}:`);
  console.log(`  Target: ${ff.diagnosis.targetUrl}`);
  console.log(`  Why:    ${ff.diagnosis.rationale}`);
  console.log('  Suggested inbound links:');
  for (const s of ff.prescription.suggestedLinks) {
    console.log(`    - from ${s.fromUrl}  anchor:"${s.anchorText}"  relevance:${s.relevanceScore.toFixed(3)}`);
  }
  console.log(`\n  --- Action packet (${ff.prescription.actionPacket.copyLabel}) ---`);
  console.log(ff.prescription.actionPacket.body.split('\n').map((l) => `  | ${l}`).join('\n'));
  console.log('  --- end action packet ---');
}
console.log(`\nPrescriptions (all cures, gated to Pro-owner downstream): ${result.prescriptions?.length ?? 0}`);

import { runAudit } from '@crawlmouse/engine';

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

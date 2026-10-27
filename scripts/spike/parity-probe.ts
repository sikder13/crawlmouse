/**
 * Client parity (spike spec 2.4). Runs ON the worker machine, so both clients leave from the same egress IP:
 *   flyctl ssh console --app crawlmouse-spike-worker -C "node --import tsx scripts/spike/parity-probe.ts --out=/tmp/parity"
 * For each site it fetches the homepage as each of the seven identities with (a) the worker's safeFetch path
 * and (b) the platform's global fetch, which is undici and is used here ONLY as the comparison client; the
 * worker never uses it. It compares the response class (served / refused / challenged ...), not bodies.
 */
import { pathToFileURL } from 'node:url';
import { createFetcher } from './worker/fetcher.js';
import { classifyResponse, type UResult } from './worker/classify.js';
import { CRAWLER_TOKENS, identityHeaders, type IdentityName } from './worker/identities.js';
import { countWords } from './worker/fetcher.js';
import { buildResults, writeResults } from './results.js';
import { parseArgs, POC2_SITES, DISCRIMINATOR_SITES } from './harness-lib.js';

export const IDENTITIES: IdentityName[] = ['browser', 'crawlmouse', 'googlebot', ...CRAWLER_TOKENS];

export interface ClientClass {
  safeFetch: UResult;
  comparison: UResult;
}

export function siteDiffers(perIdentity: ClientClass[]): boolean {
  return perIdentity.some((c) => c.safeFetch !== c.comparison);
}

async function comparisonFetch(url: string, who: IdentityName): Promise<UResult> {
  try {
    const r = await fetch(url, { headers: identityHeaders(who), redirect: 'follow', signal: AbortSignal.timeout(20_000) });
    const text = (await r.text()).slice(0, 4096 * 64);
    const h: Record<string, string> = {};
    r.headers.forEach((v, k) => (h[k] = v));
    return classifyResponse({
      status: r.status,
      headers: h,
      bodyHead: text.slice(0, 4096),
      words: r.status === 200 ? countWords(text) : 0,
      originHost: new URL(url).hostname,
      finalHost: new URL(r.url || url).hostname,
    });
  } catch {
    return 'error';
  }
}

async function main(): Promise<void> {
  const { flags } = parseArgs(['parity', ...process.argv.slice(2)]);
  const out = flags.out;
  if (!out) throw new Error('--out=DIR is required');
  const sites = flags.sites ? flags.sites.split(',') : [...POC2_SITES, ...DISCRIMINATOR_SITES];
  const fetcher = createFetcher({});
  const startedAt = new Date();
  const rows: Array<Record<string, unknown>> = [];
  for (const site of sites) {
    const url = `https://${site}/`;
    const per: ClientClass[] = [];
    for (const who of IDENTITIES) {
      const rec = await fetcher(url, who);
      const a: UResult = rec.errorClass ? 'error' : classifyResponse(rec.shape);
      await new Promise((r) => setTimeout(r, 500));
      const b = await comparisonFetch(url, who);
      await new Promise((r) => setTimeout(r, 500));
      per.push({ safeFetch: a, comparison: b });
      rows.push({ kind: 'parity-cell', site, token: who, client: 'safeFetch', result: a });
      rows.push({ kind: 'parity-cell', site, token: who, client: 'comparison', result: b });
    }
    rows.push({ kind: 'parity-site', site, differs: siteDiffers(per) });
  }
  const path = writeResults(out, buildResults('parity', startedAt, new Date(), rows));
  process.stdout.write(`parity: ${rows.filter((r) => r.kind === 'parity-site' && r.differs).length} of ${sites.length} sites differ, written to ${path}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    process.stderr.write(`parity error: ${e instanceof Error ? e.message : 'unknown'}\n`);
    process.exit(2);
  });
}

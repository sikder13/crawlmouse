/**
 * The live proof: one check of the lab site, built from a crawl of it over HTTP, with its fixes'
 * packets printed as markdown in rank order. Run from the repository root:
 *   pnpm --filter @crawlmouse/engine exec tsx fixtures/v2/build/live-proof.ts
 *
 * The site is the built-site fixture served with `guidesWithIntro` (site/serve.ts): its guides are
 * content pages whose sections arrive by JavaScript, so the check has a client-rendered template. The
 * worker crawls it and tests access on the worker's loopback test server, as generate.ts records the
 * fixture; the render is the same fake Browser Run client, answering with the site's own HTML and
 * the guides' filled-in side. Nothing is written to disk and no recorded batch is read.
 *
 * The check is built under the fixture's own name (recorded.ts HOST), as the recorded fixture is, so
 * the output does not change with the server's port. Each packet's verify command is then run against
 * the server, which still serves the site as audited, with HOST in the command replaced by the
 * server's address: the status printed is the command's own, on the site before any fix.
 */
import { startServer } from '../../../../worker/src/test-support/http.js';
import { buildCheck, type BuiltCheck } from '../../../src/v2/build/index.js';
import {
  TECHNICAL_SEO_PENDING_MEANINGS,
  WITHHELD_REASON_MEANINGS,
} from '../../../src/v2/grade/withheld.js';
import { runCommand } from '../../../src/v2/packets/test-support/verify.js';
import { record, renamed } from './generate.js';
import { HOST, recordedInput } from './recorded.js';
import { handler, type SiteVariant } from './site/serve.js';

const VARIANT: SiteVariant = { linkRedirectTarget: false, guidesWithIntro: true };

type Fix = BuiltCheck['fixes'][number];
type Body = NonNullable<Fix['packet']>['packets'][number];

const numbered = (lines: readonly string[]) => lines.map((l, i) => `${i + 1}. ${l}`);
const bullets = (lines: readonly string[]) => lines.map((l) => `- ${l}`);

/** Each recommendation class and confidence in words: the owner reads this file, not the contract. */
const CLASS: Readonly<Record<Fix['recommendation_class'], string>> = {
  documented_requirement: 'a documented requirement',
  best_practice: 'a best practice',
  confirmed_defect: 'a confirmed defect',
  experimental: 'an experimental practice',
};
const CONFIDENCE: Readonly<Record<Fix['confidence'], string>> = {
  confirmed: 'confirmed',
  likely: 'likely',
  inconclusive: 'inconclusive',
};

const points = (n: number) => `${n >= 0 ? '+' : ''}${n}`;

/** The estimated effect in words; a grade that is not estimated gives its reasons as sentences. */
function effectOf(fix: Fix): string {
  const e = fix.effect;
  const seo =
    e.technical_seo === null
      ? `not estimated. ${e.technical_seo_pending_on.map((r) => TECHNICAL_SEO_PENDING_MEANINGS[r]).join(' ')}`
      : `${points(e.technical_seo)}.`;
  const ai =
    e.ai_readability === null
      ? `not estimated. ${e.ai_readability_pending_on.map((r) => (r in WITHHELD_REASON_MEANINGS ? WITHHELD_REASON_MEANINGS[r as keyof typeof WITHHELD_REASON_MEANINGS] : 'It waits on another fix.')).join(' ')}`
      : `${points(e.ai_readability)}.`;
  return `Technical SEO ${seo} AI readability ${ai}`;
}

function bodyOf(body: Body): string[] {
  return [
    `#### Change (${body.framework})`,
    '',
    ...numbered(body.change),
    '',
    '#### Keep',
    '',
    ...bullets(body.keep),
  ];
}

async function fixOf(fix: Fix, base: string): Promise<string[]> {
  const head = [
    `## ${fix.rank}. ${fix.title}`,
    '',
    `${fix.affected_pages} affected ${fix.affected_pages === 1 ? 'page' : 'pages'}. ${CLASS[fix.recommendation_class][0]!.toUpperCase()}${CLASS[fix.recommendation_class].slice(1)}, ${CONFIDENCE[fix.confidence]}.`,
    '',
    `Estimated effect: ${effectOf(fix)}`,
    '',
  ];
  const p = fix.packet;
  if (p === null) return [...head, 'No packet is written for this fix.', ''];
  const ran = await runCommand(p.verify.command.replaceAll(HOST, base));
  return [
    ...head,
    '### Context',
    '',
    ...bullets(p.context),
    '',
    ...bodyOf(p),
    '',
    '### Verify',
    '',
    '```sh',
    p.verify.command,
    '```',
    '',
    p.verify.expect,
    '',
    `Requests as: ${p.verify.ua ?? 'no crawler'}. Run against the local server, which serves the site as audited, before any fix: exit status ${ran.status}${ran.stdout.trim() ? `, printed \`${ran.stdout.trim()}\`` : ''}.`,
    '',
    ...(p.packets.length > 0 ? ['### The same fix on other stacks', ''] : []),
    ...p.packets.flatMap((b) => [...bodyOf(b), '']),
  ];
}

/** The live proof as markdown. */
export async function liveProof(): Promise<string> {
  const server = await startServer(handler(VARIANT));
  try {
    const { base, batches, render } = await record(VARIANT, server);
    const built = buildCheck({ ...recordedInput(), batches: renamed(batches, base), render });
    const fixes = [...built.fixes].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
    const out = [
      '# Live proof: the lab site, crawled over HTTP and built into one check',
      '',
      `The built-site fixture served on a loopback test server with its guides' sections left to JavaScript, audited as ${HOST}. ${built.page_results.length} pages, ${built.access_tests.length} access tests, ${render?.pages.filter((p) => p.rendered).length ?? 0} pages rendered; ${fixes.length} fixes, ${fixes.filter((f) => f.packet !== null).length} with a packet.`,
      '',
    ];
    for (const fix of fixes) out.push(...(await fixOf(fix, base)));
    return `${out.join('\n')}\n`;
  } finally {
    await server.close();
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  process.stdout.write(await liveProof());
}

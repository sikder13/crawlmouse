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
 * the output does not change with the server's port. Each packet's two commands are then run against
 * the server, which still serves the site as audited, with HOST in the command replaced by the
 * server's address: what the readable command printed and the exact check's exit status are their
 * own, on the site before any fix.
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

/** Each framework a body is written for, in words: the labels the fix page shows, and the generic body by what it is. */
const FRAMEWORK: Readonly<Record<Body['framework'], string>> = {
  nextjs: 'Next.js',
  shopify_liquid: 'Shopify (Liquid)',
  shopify_hydrogen: 'Shopify (Hydrogen)',
  wordpress: 'WordPress',
  webflow: 'Webflow',
  generic: 'any stack',
};

/** The lines of a readable command's output this file prints before it counts the rest. */
const OUTPUT_LINES = 12;
/** The characters of one such line it prints before it says the line was cut. */
const OUTPUT_CHARS = 300;

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
    `#### Change: ${FRAMEWORK[body.framework]}`,
    '',
    ...numbered(body.change),
    '',
    '#### Keep',
    '',
    ...bullets(body.keep),
  ];
}

/** What a command printed, with the server's address put back as HOST, bounded, and saying what it left out. */
function printed(stdout: string, base: string): string[] {
  const lines = stdout.replaceAll(base, HOST).split('\n');
  while (lines.at(-1) === '') lines.pop();
  if (lines.length === 0) return ['Run against the local server, before any fix, it printed nothing.'];
  const rest = lines.length - OUTPUT_LINES;
  const shown = lines.slice(0, OUTPUT_LINES).map((l) => {
    const points = [...l];
    return points.length <= OUTPUT_CHARS
      ? l
      : `${points.slice(0, OUTPUT_CHARS).join('')} [line cut from ${points.length} characters]`;
  });
  return [
    'Run against the local server, before any fix, it printed:',
    '',
    '```',
    ...shown,
    '```',
    ...(rest > 0 ? ['', `${rest} more ${rest === 1 ? 'line is' : 'lines are'} not shown.`] : []),
  ];
}

/** The readable layer of the verify block: the command, what the packet says of it, and what it printed. */
async function seeOf(see: Body['verify']['see'], base: string): Promise<string[]> {
  if (see === null) return [];
  const ran = await runCommand(see.command.replaceAll(HOST, base));
  return [
    '#### See it',
    '',
    '```sh',
    see.command,
    '```',
    '',
    `Today: ${see.today}`,
    '',
    `After the fix: ${see.after}`,
    '',
    ...printed(ran.stdout, base),
    '',
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
    ...(await seeOf(p.verify.see, base)),
    '#### Exact check',
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

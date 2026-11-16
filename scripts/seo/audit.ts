/**
 * The public page audit (CC-40 D1). Reads a running production build's sitemap, fetches every URL it
 * lists and every app surface, and saves what each answered; `--render` turns saved runs into
 * docs/seo/page-audit.md. The analysis lives in apps/web/lib/seo (unit-tested there); this file is
 * the command line around it.
 *
 *   tsx scripts/seo/audit.ts --base=http://localhost:3100 --label="flags off" --out=docs/seo/audit-data/off.json
 *   tsx scripts/seo/audit.ts --render --off=… --on=… [--before-off=… --before-on=…] [--www]
 *
 * `--www` asks production for `https://www.crawlmouse.com/` (one GET, redirects not followed).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { auditBuild, type AuditRun } from '../../apps/web/lib/seo/audit-run';
import { renderReport } from '../../apps/web/lib/seo/audit-report';
import { POSTS } from '../../apps/web/lib/blog/posts';
import { writeFormatted } from './write-formatted';

// jsdom is apps/web's dependency; resolve it from there.
const { JSDOM } = createRequire(new URL('../../apps/web/package.json', import.meta.url))(
  'jsdom',
) as typeof import('jsdom');

const ORIGIN = 'https://crawlmouse.com';
const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const has = (name: string) => process.argv.includes(`--${name}`);
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as AuditRun;

async function main() {
  if (has('render')) {
    const www = has('www')
      ? await fetch(`https://www.${new URL(ORIGIN).host}/`, { redirect: 'manual' }).then((r) => ({
          status: r.status,
          location: r.headers.get('location'),
          checkedAt: new Date().toISOString(),
        }))
      : null;
    const before =
      arg('before-off') && arg('before-on')
        ? { off: read(arg('before-off')!), on: read(arg('before-on')!) }
        : undefined;
    const md = renderReport({
      origin: ORIGIN,
      off: read(arg('off')!),
      on: read(arg('on')!),
      before,
      posts: POSTS,
      www,
      commands: [
        '# each build: NEXT_PUBLIC_BASE_URL=https://crawlmouse.com, .env.ci placeholders; flags on = V2_ACCOUNT_DOOR=1 V2_PIPELINE=1 V2_CHECKS_PUBLIC=1 V2_BILLING=1',
        'pnpm --filter @crawlmouse/web exec next start -p 3100',
        'pnpm seo:audit -- --base=http://localhost:3100 --label="flags off" --out=docs/seo/audit-data/off.json',
        'pnpm seo:audit -- --render --off=docs/seo/audit-data/off.json --on=docs/seo/audit-data/on.json --www',
      ],
    });
    await writeFormatted(arg('md') ?? 'docs/seo/page-audit.md', md);
    return;
  }
  const base = arg('base');
  if (!base) throw new Error('--base=<url of the running build> is required');
  const run = await auditBuild({
    base: base.replace(/\/+$/, ''),
    origin: ORIGIN,
    label: arg('label') ?? base,
    sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    fetch: (url, init) => fetch(url, init),
    parse: (html) => new JSDOM(html).window.document,
  });
  await writeFormatted(arg('out')!, JSON.stringify(run));
  console.log(
    `${run.label}: ${run.pages.length} pages, ${run.surfaces.length} app surfaces → ${arg('out')}`,
  );
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});

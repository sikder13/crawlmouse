/**
 * The content packets the check builder writes for the built-site fixture (expected.json), run
 * against the site itself: each command fails on the site as the fixture serves it, and passes once
 * its pages describe themselves in JSON-LD.
 */
import { readFileSync } from 'node:fs';
import type { RequestListener } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { Fix } from '@crawlmouse/types/v2';
import { handler } from '../../../fixtures/v2/build/site/serve.js';
import { CRAWLER_REGISTRY_V2 } from '../crawler-registry.js';
import { userAgentOf } from './crawler.js';
import { engineVerdict } from './test-support/content.js';
import { inBothStates, twoStateSite, type TwoStateSite } from './test-support/verify.js';

const EXPECTED = new URL('../../../fixtures/v2/build/expected.json', import.meta.url);
const RECORDED_HOST = 'https://built-site.test';
const TYPE = 'missing_schema_description';

const fixes = (JSON.parse(readFileSync(EXPECTED, 'utf8')) as { fixes: Fix[] }).fixes.filter(
  (f) => f.type === TYPE,
);

const DESCRIBED = `<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: 'A page',
  description: 'What this page is about.',
})}</script>`;

/** The fixture site with a described WebPage node added to the head of each HTML page. */
const described: RequestListener = (req, res) => {
  const end = res.end.bind(res) as (body?: unknown) => typeof res;
  res.end = ((body?: unknown) =>
    end(
      typeof body === 'string' ? body.replace('</head>', `${DESCRIBED}</head>`) : body,
    )) as typeof res.end;
  handler()(req, res);
};

let site: TwoStateSite | null = null;
afterEach(async () => {
  await site?.close();
  site = null;
});

describe('the built-site fixture’s missing_schema_description packets, against the site', () => {
  it('has a packet for each of the three templates the fixture plants the fault on', () => {
    expect(fixes.map((f) => f.template_key)).toEqual([
      '/blog/{slug}',
      '/collections/{slug}',
      '/journal/{slug}',
    ]);
    expect(fixes.every((f) => f.packet !== null)).toBe(true);
  });

  it.each(fixes.map((f) => [f.template_key, f] as const))(
    '%s: the command fails on the site as recorded and passes once the pages are described',
    async (_template, fix) => {
      site = await twoStateSite({ broken: handler(), fixed: described });
      const { command, ua } = fix.packet!.verify;
      expect(command).toContain(RECORDED_HOST);
      const onSite = command.replaceAll(RECORDED_HOST, site.base);

      const { broken, fixed } = await inBothStates(site, onSite);
      expect(broken.status).toBe(1);
      expect(fixed.status).toBe(0);

      // the command failed on the page's markup, not on a refusal: the crawler it requests as is
      // served the page, and the engine's own check fails what it is served
      const entry = CRAWLER_REGISTRY_V2.find((e) => e.token === ua)!;
      expect(site.userAgents()).toEqual([userAgentOf(entry), userAgentOf(entry)]);
      const page = command.match(/'(https:\/\/built-site\.test[^']*)'/)![1]!;
      site.use('broken');
      const served = await fetch(page.replace(RECORDED_HOST, site.base), {
        headers: { 'user-agent': userAgentOf(entry) },
      });
      expect(served.status).toBe(200);
      expect(engineVerdict(TYPE, await served.text())).toBe('fail');
    },
  );
});

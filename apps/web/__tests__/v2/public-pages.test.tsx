/**
 * CC-29 D1, D4, D5, D8, D9: the flags that keep the new public pages dark, and what each page says
 * to search engines when it is lit.
 *
 * - With V2_BILLING unset, `/pricing` and `/developers` are v1's files, byte for byte as main has
 *   them, and neither reaches a v2 module; that the middleware does not rewrite them is pinned in
 *   `middleware.test.ts` ("the CC-29 rows").
 * - `/agencies` and the `/v2-developers` target are 404s with V2_BILLING unset; the three `/check`
 *   pages are 404s with V2_CHECKS_PUBLIC unset, and every other `/check` segment is a 404 always.
 * - Lit, each has its own canonical, no robots of its own (the root layout's, which index), one h1,
 *   and no "#" link.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHECK_COPY, CHECK_QUESTIONS } from '../../lib/v2/copy/check-pages';
import { V2_REWRITES } from '../../lib/v2/rewrites';
import { WEB_ROOT } from './_lib/tokens-css';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** Next's notFound() throws an error whose digest names the 404 fallback. */
async function digestOf(render: () => unknown): Promise<string> {
  try {
    await render();
  } catch (error) {
    return String((error as { digest?: unknown }).digest);
  }
  return 'rendered';
}

function flags(f: { billing?: boolean; checks?: boolean }) {
  vi.stubEnv('V2_BILLING', f.billing ? '1' : '');
  vi.stubEnv('V2_CHECKS_PUBLIC', f.checks ? '1' : '');
}

describe('v1’s /pricing and /developers with V2_BILLING unset (D1)', () => {
  // main's files, pinned by content so the test needs no git ref (a shallow CI checkout has no
  // origin/main), as live-home.test.tsx pins the home. Taken at origin/main ac9605e5; when main's
  // page changes, recompute with
  //   git show origin/main:apps/web/app/<page>/page.tsx | sha256sum
  const MAIN_SHA256 = {
    'app/pricing/page.tsx': 'df30ef5ed6f50016236d7c930071689d7e61d5548eba027dde3c8ff94aeafca7',
    'app/developers/page.tsx': 'becdc256b7c335885adeef5b3b731f53152572ad334d124f139dd98ac354488f',
  };

  it.each(Object.entries(MAIN_SHA256))('%s is the file main has', (file, sha) => {
    const source = readFileSync(join(WEB_ROOT, file), 'utf8');
    expect(createHash('sha256').update(source).digest('hex')).toBe(sha);
  });

  it.each(Object.keys(MAIN_SHA256))('%s reaches no v2 module, by import or import()', (file) => {
    const source = readFileSync(join(WEB_ROOT, file), 'utf8');
    const reached = [...source.matchAll(/(?:from\s+|import\(\s*)'([^']+)'/g)].map((m) => m[1]!);
    expect(reached.length).toBeGreaterThan(2);
    expect(reached.filter((m) => /components\/v2|styles\/v2|lib\/v2/.test(m))).toEqual([]);
  });

  it('serves the v2 Developers page from the target the rewrite row names, under the billing flag', () => {
    expect(V2_REWRITES.find((r) => r.from === '/developers')).toEqual({
      from: '/developers',
      to: '/v2-developers',
      flag: 'billing',
    });
  });
});

describe('/agencies (D4)', () => {
  const load = () => import('../../app/agencies/page');

  it('is a 404 with V2_BILLING unset, whatever V2_CHECKS_PUBLIC says', async () => {
    for (const checks of [false, true]) {
      flags({ billing: false, checks });
      const { default: Page } = await load();
      expect(await digestOf(() => Page())).toContain('404');
      vi.resetModules();
    }
  }, 60_000);

  it('with V2_BILLING on is the page, canonical at /agencies, indexable', async () => {
    flags({ billing: true, checks: true });
    const { default: Page, metadata } = await load();
    expect(metadata.alternates?.canonical).toBe('/agencies');
    expect(metadata.robots).toBeUndefined();
    expect(metadata.title).toBe('For agencies');
    const markup = renderToStaticMarkup(Page() as ReactElement);
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).not.toContain('href="#"');
    expect(markup).toContain('name="url"');
  }, 60_000);

  it('with public checks off links the prospect’s audit to the home instead of a form with no route', async () => {
    flags({ billing: true, checks: false });
    const { default: Page } = await load();
    const markup = renderToStaticMarkup(Page() as ReactElement);
    expect(markup).not.toContain('name="url"');
    expect(markup).toContain('href="/"');
  }, 60_000);
});

describe('/developers, v2 (D5)', () => {
  const load = () => import('../../app/v2-developers/page');

  it('is a 404 with V2_BILLING unset', async () => {
    flags({ billing: false, checks: true });
    const { default: Page } = await load();
    expect(await digestOf(() => Page())).toContain('404');
  }, 60_000);

  it('with V2_BILLING on keeps v1’s canonical, takes the artboard’s title, and is indexable', async () => {
    flags({ billing: true, checks: true });
    const { default: Page, metadata } = await load();
    expect(metadata.alternates?.canonical).toBe('/developers');
    expect(metadata.robots).toBeUndefined();
    expect(metadata.title).toBe('Developers');
    const markup = renderToStaticMarkup(Page() as ReactElement);
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).not.toContain('href="#"');
    expect(markup.match(/data-v2-primary=""/g)).toHaveLength(1);
    expect(markup).toContain('name="email"');
  }, 60_000);
});

describe('/check/[question] (D8)', () => {
  const load = () => import('../../app/check/[question]/page');
  const params = (question: string) => ({ params: Promise.resolve({ question }) });

  it('builds the three questions and no other segment', async () => {
    const route = await load();
    expect(route.dynamicParams).toBe(false);
    expect(route.generateStaticParams()).toEqual(CHECK_QUESTIONS.map((question) => ({ question })));
    expect(CHECK_QUESTIONS).toEqual(['gptbot', 'javascript', 'robots-ai']);
  });

  it.each(CHECK_QUESTIONS)(
    '/check/%s is a 404 with V2_CHECKS_PUBLIC unset',
    async (q) => {
      flags({ billing: true, checks: false });
      const { default: Page } = await load();
      expect(await digestOf(() => Page(params(q)))).toContain('404');
    },
    60_000,
  );

  it('answers 404 for a question it does not have, with the flag on', async () => {
    flags({ checks: true });
    const { default: Page } = await load();
    expect(await digestOf(() => Page(params('bingbot')))).toContain('404');
  }, 60_000);

  it.each(CHECK_QUESTIONS)(
    '/check/%s with V2_CHECKS_PUBLIC on opens with its question, with its own title and canonical',
    async (q) => {
      flags({ checks: true });
      const { default: Page, generateMetadata } = await load();
      const metadata = await generateMetadata(params(q));
      expect(metadata.alternates?.canonical).toBe(`/check/${q}`);
      expect(metadata.title).toBe(CHECK_COPY[q].title);
      expect(String(metadata.title)).toContain('AI visibility');
      expect(metadata.robots).toBeUndefined();
      const markup = renderToStaticMarkup((await Page(params(q))) as ReactElement);
      expect(markup.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1]).toBe(
        CHECK_COPY[q].h1.replace(/'/g, '&#x27;'),
      );
      expect(markup.match(/<h1/g)).toHaveLength(1);
      expect(markup.match(/data-v2-primary=""/g)).toHaveLength(1);
      expect(markup.match(/Start the audit/g)).toHaveLength(2);
      expect(markup).not.toContain('href="#"');
    },
    60_000,
  );
});

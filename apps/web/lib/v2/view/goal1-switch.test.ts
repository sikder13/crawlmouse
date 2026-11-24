/**
 * Goal 1 rule 2 on the public pages: a feature named in `V2_HIDE_FEATURES` disappears from Pricing,
 * For agencies, Home, the free check pages and `/llms.txt`. With nothing hidden, each view's output
 * equals its output with every feature passed as shown, and the rows this file names keep the words
 * pinned under "nothing hidden" and in Home's first case. The views take the switch's answer as a plain record (`features`); the server entry
 * points call `shownFeatures()`. `/agencies`, `/`, `/check/*` and `/llms.txt` are static, so they
 * read the switch at build time and a change to it takes a redeploy; `/pricing` reads it per request.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgenciesScreen } from '../../../components/v2/screens/agencies/AgenciesScreen';
import { HomeScreen } from '../../../components/v2/screens/home/HomeScreen';
import { homePreview } from '../../../app/(v2-preview)/v2-preview/_preview/screens';
import { v2KeyPages } from '../../seo/llms-v2';
import { v2LlmsDescriptor } from '../../seo/site-copy';
import type { RiskFeature } from '../../feature-switch';
import { ALL_SHOWN, NOJS_FIX_TYPES, type Features } from '../features';
import { agenciesView } from './agencies';
import { checkDescription, checkPageView } from './check-pages';
import { pricingView } from './pricing';
import mapStyles from '../../../components/v2/map/MapSvg.module.css';
import type { Check } from '@crawlmouse/types/v2';
import { findCheck, fixesAsOf, fixture } from '../fixtures';
import { CHECKS } from '../recordings';
import { headline } from '../reports/build-snapshot';
import { aiShortSummary } from '../sentences';

vi.mock('server-only', () => ({}));
vi.mock('@/components/analytics/TrackView', () => ({ TrackView: () => null }));
vi.mock('@/components/analytics/ReferralCapture', () => ({ ReferralCapture: () => null }));
const { RISK_FEATURES } = await import('../../feature-switch');

const WEB = join(__dirname, '..', '..', '..');
const NOW = new Date('2026-11-24T12:00:00Z');
const FLAGS = { billing: true, checksPublic: true, accountDoor: true };
const SAMPLE_AGENCY_NAME = 'Summit Digital';

/** Every feature shown, built from the switch's own list rather than from `ALL_SHOWN`. */
const EVERY = Object.fromEntries(RISK_FEATURES.map((f) => [f, true])) as Features;
const hide = (...names: RiskFeature[]): Features => ({
  ...EVERY,
  ...Object.fromEntries(names.map((n) => [n, false])),
});

const pricing = (f?: Features) => pricingView({ kind: 'signed_out' }, 'month', NOW, FLAGS, f);
const agencies = (f?: Features) => agenciesView({ billing: true, accountDoor: true }, f);
const text = (v: unknown) => JSON.stringify(v);
const agenciesHtml = (f: Features) =>
  renderToStaticMarkup(createElement(AgenciesScreen, { data: agencies(f), audit: 'live' }));
const homeHtml = (f?: Features) =>
  renderToStaticMarkup(createElement(HomeScreen, { data: homePreview(f) }));
const words = (html: string) => html.replace(/<[^>]+>/g, ' ');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('nothing hidden', () => {
  it('ALL_SHOWN names the switch’s features, each shown', () => {
    expect(Object.keys(ALL_SHOWN).sort()).toEqual([...RISK_FEATURES].sort());
    expect(Object.values(ALL_SHOWN).every((v) => v === true)).toBe(true);
  });

  it('each view with no record equals the view with every feature passed as shown', () => {
    expect(text(pricing())).toBe(text(pricing(EVERY)));
    expect(text(agencies())).toBe(text(agencies(EVERY)));
    expect(text(homePreview())).toBe(text(homePreview(EVERY)));
    for (const q of ['gptbot', 'javascript', 'robots-ai'] as const) {
      expect(text(checkPageView(q))).toBe(text(checkPageView(q, EVERY)));
      expect(checkDescription(q)).toBe(checkDescription(q, EVERY));
    }
    expect(v2LlmsDescriptor()).toBe(v2LlmsDescriptor(EVERY));
  });

  it('the pages still name competitors, 2,000 pages, client reports and the one-pager', () => {
    expect(text(pricing())).toMatch(/competitor/i);
    expect(text(pricing())).toContain('2,000 pages');
    expect(text(agencies())).toMatch(/client report/i);
    expect(words(agenciesHtml(EVERY))).toContain('The prospect one-pager');
  });

  it('the branding rows keep their words', () => {
    const agencyRows = pricing().plans.find((p) => p.tier === 'agency')!.rows;
    expect(agencyRows.map((r) => r.text)).toContain(
      'Reports on your domain with your logo; emails from your address',
    );
    expect(agencies().compare.rows.map((r) => r.label.text)).toContain(
      'Reports and client report pages on your domain, your logo',
    );
  });
});

/** The source files under `dir`, tests aside. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name.startsWith('.')) return [];
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.(?:tsx?|mjs|js)$/.test(e.name) && !/\.(?:test|spec)\./.test(e.name) ? [path] : [];
  });
}

/**
 * The files a module's value imports name: `import`, `export … from` and `import()` with a relative
 * or `@/` path, `import type` and `export type` left out (the compiler erases them). A package import
 * is not followed.
 */
function valueImports(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const specs = [
    ...[
      ...source.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s*['"]([^'"]+)['"]/gm),
    ].map((m) => m[1]!),
    ...[...source.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]!),
    ...[...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]!),
  ];
  return specs.flatMap((spec) => {
    const base = spec.startsWith('@/')
      ? join(WEB, spec.slice(2))
      : spec.startsWith('.')
        ? join(dirname(file), spec)
        : null;
    if (base === null) return [];
    const found = ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx']
      .map((ext) => base + ext)
      .find((f) => existsSync(f) && statSync(f).isFile() && /\.(?:tsx?|mjs|js)$/.test(f));
    return found ? [found] : [];
  });
}

describe('no module a client component reaches imports the switch as a value', () => {
  // AgencyPlusForm.tsx is 'use client' and imports the pricing copy; 'server-only' would fail it.
  // Every 'use client' file under app, components and lib, and each file its value imports reach.
  const roots = ['app', 'components', 'lib']
    .flatMap((d) => sources(join(WEB, d)))
    .filter((f) =>
      /^(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*['"]use client['"]/.test(readFileSync(f, 'utf8')),
    );
  const reached = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const f = queue.pop()!;
    if (reached.has(f)) continue;
    reached.add(f);
    queue.push(...valueImports(f));
  }
  const rel = (f: string) => relative(WEB, f);

  it('the walk starts at client files and reaches the modules that take the record', () => {
    expect(roots.map(rel)).toContain('components/v2/screens/pricing/AgencyPlusForm.tsx');
    const seen = [...reached].map(rel);
    for (const f of ['lib/v2/copy/pricing.ts', 'lib/v2/features.ts']) expect(seen).toContain(f);
  });

  it('lib/feature-switch.ts is not among them', () => {
    expect([...reached].map(rel)).not.toContain('lib/feature-switch.ts');
  });
});

describe('Pricing and For agencies', () => {
  it('competitors hidden: no competitor sentence on either page', () => {
    expect(text(pricing(hide('competitors')))).not.toMatch(/competitor/i);
    expect(text(agencies(hide('competitors')))).not.toMatch(/competitor/i);
  });

  it.each(['month', 'year'] as const)(
    'pages_2000 hidden (%s): Free keeps its limit, the paid plans state no page figure',
    (interval) => {
      const view = (f?: Features) => pricingView({ kind: 'signed_out' }, interval, NOW, FLAGS, f);
      const rows = (f: Features | undefined, tier: string) =>
        view(f)
          .plans.find((p) => p.tier === tier)!
          .rows.map((r) => r.text);
      expect(rows(undefined, 'pro')).toContain('Up to 2,000 pages per audit');
      expect(rows(undefined, 'agency').join(' ')).toContain('up to 2,000 pages per audit');
      const hidden = hide('pages_2000');
      expect(text(view(hidden))).not.toContain('2,000');
      expect(rows(hidden, 'free')).toContain('Up to 500 pages per audit');
      for (const tier of ['pro', 'agency']) {
        expect(rows(hidden, tier).join(' ')).not.toMatch(/pages per audit|\b500 pages/);
      }
      expect(rows(hidden, 'pro')).toContain('Each with its own audits');
    },
  );

  it('staging_deploys hidden: no staging or preview sentence', () => {
    expect(text(pricing())).toMatch(/staging/i);
    expect(text(pricing(hide('staging_deploys')))).not.toMatch(/staging|preview URL/i);
  });

  it('rendering hidden: no renders row', () => {
    expect(text(pricing())).toContain('Full JavaScript renders');
    expect(text(pricing(hide('rendering')))).not.toContain('Full JavaScript renders');
  });

  it('ai_letter hidden: the crawler line names no grade', () => {
    expect(text(pricing().crawlers)).toContain('count towards your grade');
    expect(text(pricing(hide('ai_letter')).crawlers)).not.toMatch(/grade/i);
  });

  it('ai_letter hidden: the one-pager sample shows Technical SEO alone', () => {
    expect(agencies().onePager.grades.map((g) => g.label)).toEqual([
      'Technical SEO',
      'AI readability',
    ]);
    expect(agencies(hide('ai_letter')).onePager.grades.map((g) => g.label)).toEqual([
      'Technical SEO',
    ]);
    expect(words(agenciesHtml(hide('ai_letter')))).not.toContain('AI readability');
  });

  it('agency_domain hidden: no "emails from your address" on either page', () => {
    expect(text(pricing())).toMatch(/emails from your address/i);
    expect(text(agencies())).toMatch(/emails from your address/i);
    expect(text(pricing(hide('agency_domain')))).not.toMatch(/emails from your address/i);
    expect(text(agencies(hide('agency_domain')))).not.toMatch(/emails from your address/i);
  });

  it.each(['agency_white_label', 'agency_domain'] as const)(
    '%s hidden: the Agency card keeps a description that names no hidden feature',
    (name) => {
      const card = pricing(hide(name)).plans.find((p) => p.tier === 'agency')!;
      expect(card.description.hidden).toBe(false);
      expect(card.description.text).not.toBe('');
      expect(card.description.text).not.toMatch(/report|brand|logo|domain|own name/i);
    },
  );

  it.each(['agency_white_label', 'agency_domain'] as const)(
    '%s hidden: For agencies renders no one-pager section and no empty heading',
    (name) => {
      const html = agenciesHtml(hide(name));
      expect(words(html)).not.toContain('The prospect one-pager');
      expect(html).not.toContain(SAMPLE_AGENCY_NAME);
      expect(html).not.toMatch(/<h[1-6][^>]*>\s*<\/h[1-6]>/);
    },
  );

  it.each(['agency_white_label', 'agency_domain'] as const)(
    '%s hidden: the description and the /llms.txt line drop the branded reports',
    (name) => {
      vi.stubEnv('V2_BILLING', '1');
      expect(agencies().description).toContain('branded client reports are coming');
      const description = agencies(hide(name)).description;
      expect(description).not.toMatch(/branded|client report/i);
      expect(description).toContain('client sites');
      const line = v2KeyPages(hide(name)).find(([, path]) => path === '/agencies')!;
      expect(line[2]).toBe(description);
    },
  );
});

describe('the client report page under either agency name', () => {
  it.each(['agency_white_label', 'agency_domain'] as const)(
    '%s alone hidden: no Pricing row names the logo or the domain',
    (name) => {
      const rows = pricing(hide(name)).plans.flatMap((p) => p.rows.map((r) => r.text));
      expect(rows.filter((t) => /logo|your domain/i.test(t))).toEqual([]);
    },
  );

  it.each(['agency_white_label', 'agency_domain'] as const)(
    '%s alone hidden: no For agencies compare row names the logo, the domain or the client page',
    (name) => {
      const rows = agencies(hide(name)).compare.rows.map((r) => r.label.text);
      expect(rows.filter((t) => /logo|domain|client report page/i.test(t))).toEqual([]);
      expect(rows).toContain('Sites');
    },
  );
});

/** The bad-site fixture's first audit, read directly. */
const BAD = findCheck(fixture('bad-site'), CHECKS.badFirstAudit);
const keptOut = (crawlers: Check['crawlers']) =>
  crawlers
    .filter((c) => !c.verdict.startsWith('allowed'))
    .map((c) => [c.ua, c.verdict])
    .sort(([a], [b]) => a!.localeCompare(b!));

/**
 * The fixture's audit with crawlers given `like`'s result (its verdict, cause, share and templates):
 * the kept-out ones, or with `every`, all of them.
 */
function letIn(like: string, every = false): Check {
  const m = BAD.crawlers.find((c) => c.ua === like)!;
  const as = {
    verdict: m.verdict,
    cause: m.cause,
    text_share: m.text_share,
    by_template: m.by_template,
  };
  return {
    ...BAD,
    crawlers: BAD.crawlers.map((c) =>
      every || !c.verdict.startsWith('allowed') ? { ...c, ...as } : c,
    ),
  };
}

describe('the summaries with no crawler kept out', () => {
  const HOST = 'example-outfitter.com';

  it('a thin template, nojs hidden: who gets in, no share and no "reads"', () => {
    const thin = letIn('OAI-SearchBot');
    expect(keptOut(thin.crawlers)).toEqual([]);
    // Omitted, the output is what it was: the thin sentence alone.
    expect(aiShortSummary(thin)).toBe('Product pages are empty without JavaScript.');
    expect(headline(thin, HOST)).toBe('Product pages are empty without JavaScript.');
    expect(aiShortSummary(thin, false)).toBe('All four scored crawlers get in.');
    expect(headline(thin, HOST, false)).toBe(`Every crawler we tested is let in to ${HOST}.`);
  });

  it('no thin template: omitted, the all-in sentences are unchanged', () => {
    const asRead = letIn('Googlebot', true);
    expect(aiShortSummary(asRead)).toBe(
      'All four scored crawlers get in and read 100% of the text or more.',
    );
    expect(headline(asRead, HOST)).toBe(`Every crawler we tested reads ${HOST}.`);
    expect(aiShortSummary(asRead, false)).toBe('All four scored crawlers get in.');
  });
});

describe('For agencies under nojs', () => {
  it('the one-pager heading drops the empty-without-JavaScript sentence', () => {
    expect(agencies().onePager.heading).toBe(
      'example-outfitter.com: GPTBot is blocked by a firewall rule; PerplexityBot gets a challenge page. Product pages are empty without JavaScript.',
    );
    // The fixture's crawlers kept out: GPTBot by a Cloudflare rule, PerplexityBot by a challenge.
    expect(keptOut(BAD.crawlers)).toEqual([
      ['GPTBot', 'blocked_by_ua_rule'],
      ['PerplexityBot', 'challenged_ua'],
    ]);
    expect(agencies(hide('nojs')).onePager.heading).toBe(
      'example-outfitter.com: GPTBot is blocked by a firewall rule; PerplexityBot gets a challenge page.',
    );
    expect(agenciesHtml(hide('nojs'))).not.toContain('empty without JavaScript');
  });

  it('the one-pager lists no without-JavaScript fix, and its caption counts what it lists', () => {
    const d = fixture('bad-site');
    const typeOf = new Map(
      fixesAsOf(d, findCheck(d, CHECKS.badFirstAudit)).map((f) => [f.title, f.type]),
    );
    const types = (f?: Features) => agencies(f).onePager.fixes.map((x) => typeOf.get(x.key));
    // Nothing hidden: the three fixes, client rendering among them, as before the switch.
    expect(agencies().onePager.fixes.map((x) => x.title)).toEqual([
      'Let GPTBot and PerplexityBot through Cloudflare',
      'Server-render the product template, 158 pages',
      'Link the 7 orphan pages from their collections',
    ]);
    expect(types()).toContain('client_rendered_template');
    expect(agencies().onePager.fixesCaption).toBe('Three fixes, effects estimated');
    const hidden = agencies(hide('nojs')).onePager;
    expect(types(hide('nojs')).filter((t) => t === undefined || NOJS_FIX_TYPES.has(t))).toEqual([]);
    expect(hidden.fixes.map((x) => [x.n, x.title])).toEqual([
      [1, 'Let GPTBot and PerplexityBot through Cloudflare'],
      [2, 'Link the 7 orphan pages from their collections'],
    ]);
    expect(hidden.fixesCaption).toBe('Two fixes, effects estimated');
    expect(words(agenciesHtml(EVERY))).toContain('Server-render the product template');
    expect(words(agenciesHtml(hide('nojs')))).not.toMatch(/server-render|client-rendered/i);
  });
});

describe('Home', () => {
  it('nothing hidden: the locked plan cards, the words card, the text column and the legend', () => {
    const t = words(homeHtml());
    expect(t).toContain('alerts to Slack, one competitor per site, PDF and CSV export.');
    expect(t).toContain(
      'Twenty-five client sites, five seats, reports on your domain with your logo, and a one-page audit you can hand to a prospect.',
    );
    expect(t).toContain('A browser sees');
    expect(t).toContain('Text it can read');
    expect(t).toContain('only through JavaScript');
  });

  it('competitors, the agency features and nojs hidden: none of them is named', () => {
    const t = words(homeHtml(hide('competitors', 'agency_domain', 'agency_white_label', 'nojs')));
    expect(t).not.toMatch(/competitor/i);
    expect(t).toContain('Twenty-five client sites and five seats.');
    expect(t).not.toContain('A browser sees');
    expect(t).not.toContain('run JavaScript. How much');
  });

  it('agency_domain alone hidden: the one-page audit stays, the domain and logo go', () => {
    expect(words(homeHtml(hide('agency_domain')))).toContain(
      'Twenty-five client sites, five seats, and a one-page audit you can hand to a prospect.',
    );
  });

  it('agency_white_label alone hidden: the domain, the logo and the one-page audit go', () => {
    expect(words(homeHtml(hide('agency_white_label')))).toContain(
      'Twenty-five client sites and five seats.',
    );
  });

  it.each(['agency_white_label', 'agency_domain'] as const)(
    '%s alone hidden: Home names no logo and no domain',
    (name) => {
      expect(words(homeHtml())).toContain('your logo');
      expect(words(homeHtml(hide(name)))).not.toMatch(/logo|your domain/i);
    },
  );

  it('nojs hidden: the map draws no JavaScript-only node and its label names no JavaScript', () => {
    const label = (html: string) => /<svg[^>]*data-v2-map[^>]*>/.exec(html)![0];
    const shown = homeHtml();
    expect(label(shown)).toContain('only through JavaScript');
    expect(shown).toContain('data-v2-kind="js_only"');
    const html = homeHtml(hide('nojs'));
    expect(label(html)).toMatch(/aria-label="Map of the site/);
    expect(label(html)).not.toMatch(/JavaScript/);
    expect(html).not.toContain('data-v2-kind="js_only"');
    expect(html).not.toContain('only through JavaScript');
  });

  it('nojs hidden: the map draws no dashed JavaScript edge', () => {
    // The class MapSvg gives a link followed through JavaScript, read from its own CSS module.
    const edgeJs = new RegExp(`class="[^"]*\\b${mapStyles.edgeJs}\\b`);
    expect(mapStyles.edgeJs).toBeTruthy();
    expect(homeHtml()).toMatch(edgeJs);
    expect(homeHtml(hide('nojs'))).not.toMatch(edgeJs);
    expect(homePreview(hide('nojs')).example.map.nodes.some((n) => n.via === 'javascript')).toBe(
      false,
    );
  });

  it('nojs hidden: the AI readability summary drops the empty-without-JavaScript sentence', () => {
    const summary = (f?: Features) =>
      homePreview(f).example.grades.find((g) => g.label === 'AI readability')!.summary;
    expect(summary()).toBe(
      'PerplexityBot gets a challenge page. Product pages are empty without JavaScript.',
    );
    // The fixture's one scored crawler kept out is PerplexityBot, challenged by Bot Fight Mode.
    expect(keptOut(BAD.crawlers.filter((c) => c.scored))).toEqual([
      ['PerplexityBot', 'challenged_ua'],
    ]);
    expect(summary(hide('nojs'))).toBe('PerplexityBot gets a challenge page.');
  });

  it('nojs hidden: the crawler table drops its text column whole, and the legend its item', () => {
    const html = homeHtml(hide('nojs'));
    expect(words(html)).not.toContain('Text it can read');
    expect(words(html)).not.toContain('only through JavaScript');
    expect(homePreview(hide('nojs')).crawlers.rows.every((r) => r.text === null)).toBe(true);
    // The header and each row have the same number of cells: four, with the column gone.
    const table = html.slice(html.indexOf('What each crawler got back'));
    const head = table.slice(0, table.indexOf('</thead>'));
    const body = table.slice(table.indexOf('<tbody'), table.indexOf('</tbody>'));
    expect((head.match(/<th\b/g) ?? []).length).toBe(4);
    const rows = body.split('</tr>').filter((r) => /<t[dh]\b/.test(r));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect((r.match(/<t[dh]\b/g) ?? []).length).toBe(4);
  });

  it('nojs hidden: the crawler table names no thin verdict and no client-rendered template', () => {
    const claude = (f?: Features) =>
      homePreview(f).crawlers.rows.find((r) => r.crawler === 'ClaudeBot')!;
    const verdicts = (f?: Features) =>
      homePreview(f).crawlers.rows.flatMap((r) => [r.homepage.verdict, r.products.verdict]);
    // Nothing hidden: ClaudeBot reads the product template thin, and the cell says why.
    expect(claude().products.verdict).toBe('allowed_thin');
    expect(claude().obstacle).toBe('the product template is client-rendered');
    expect(words(homeHtml())).toContain('allowed, thin');
    expect(words(homeHtml())).toContain('client-rendered');
    expect(verdicts(hide('nojs'))).not.toContain('allowed_thin');
    expect(claude(hide('nojs')).products.verdict).toBe('allowed');
    expect(claude(hide('nojs')).obstacle).toBe('nothing: robots.txt and the edge let it in');
    const t = words(homeHtml(hide('nojs')));
    expect(t).not.toMatch(/allowed, thin|client-rendered|server-render/i);
  });

  it('ai_letter hidden: the example shows Technical SEO alone', () => {
    expect(homePreview().example.grades.map((g) => g.label)).toEqual([
      'Technical SEO',
      'AI readability',
    ]);
    expect(homePreview(hide('ai_letter')).example.grades.map((g) => g.label)).toEqual([
      'Technical SEO',
    ]);
  });
});

describe('the free check pages and /llms.txt', () => {
  it('nothing hidden: the grade sentence and the per-page figure are there', () => {
    expect(text(checkPageView('gptbot'))).toContain('AI readability grade');
    expect(text(checkPageView('javascript'))).toContain('page by page, and gives you the number');
    expect(checkDescription('javascript')).toContain('page by page');
    expect(v2LlmsDescriptor()).toContain('AI readability');
  });

  it('ai_letter hidden: /check/gptbot names no grade, and the descriptor no AI readability', () => {
    expect(text(checkPageView('gptbot', hide('ai_letter')))).not.toMatch(/readability grade/i);
    expect(v2LlmsDescriptor(hide('ai_letter'))).not.toContain('AI readability');
    expect(v2LlmsDescriptor(hide('ai_letter'))).toContain('grades SEO');
  });

  it('nojs hidden: /check/javascript promises no per-page figure, keeps its h1 and title', () => {
    const p = text(checkPageView('javascript', hide('nojs')));
    expect(p).not.toContain('gives you the number');
    // The sample's per-page figure ("… shows N words in a browser and M to GPTBot …").
    expect(text(checkPageView('javascript'))).toContain('words in a browser');
    expect(p).not.toContain('words in a browser');
    expect(p).toContain('Can AI crawlers read your site without JavaScript?');
    expect(p).toContain('shows you what each one is served');
    const description = checkDescription('javascript', hide('nojs'));
    expect(description).not.toMatch(/page by page|how much/i);
    const find = (pages: ReturnType<typeof v2KeyPages>) =>
      pages.find(([, path]) => path === '/check/javascript')!;
    const line = find(v2KeyPages(hide('nojs')));
    expect(line[0]).toBe(find(v2KeyPages())[0]);
    expect(line[2]).toBe(description);
  });
});

describe('the server entry points read the switch', () => {
  it('/agencies: its meta, Open Graph and Twitter text under agency_white_label', async () => {
    vi.stubEnv('V2_BILLING', '1');
    vi.stubEnv('V2_HIDE_FEATURES', 'agency_white_label');
    const { metadata } = await import('../../../app/agencies/page');
    const all = JSON.stringify([
      metadata.description,
      metadata.openGraph?.description,
      metadata.twitter?.description,
    ]);
    expect(all).toContain('client sites');
    expect(all).not.toMatch(/branded|client report/i);
    expect(metadata.title).toBe('For agencies');
  });

  it('/check/javascript: its meta description under nojs, the title kept', async () => {
    vi.stubEnv('V2_HIDE_FEATURES', 'nojs');
    const { generateMetadata } = await import('../../../app/check/[question]/page');
    const m = await generateMetadata({ params: Promise.resolve({ question: 'javascript' }) });
    expect(m.description).toBe(checkDescription('javascript', hide('nojs')));
    expect(m.openGraph?.description).toBe(m.description);
    expect(m.title).toBe('AI crawlers and JavaScript: AI visibility check');
  });

  it('/check/javascript: the page body under nojs', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    const { default: CheckPage } = await import('../../../app/check/[question]/page');
    const render = async () =>
      renderToStaticMarkup(
        (await CheckPage({ params: Promise.resolve({ question: 'javascript' }) })) as ReactElement,
      );
    expect(await render()).toContain('words in a browser');
    vi.stubEnv('V2_HIDE_FEATURES', 'nojs');
    const html = await render();
    expect(html).not.toContain('words in a browser');
    expect(html).toContain('Can AI crawlers read your site without JavaScript?');
  });

  it('/llms.txt: the descriptor and the key pages under ai_letter and nojs', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    vi.stubEnv('V2_HIDE_FEATURES', 'ai_letter,nojs');
    const { GET } = await import('../../../app/llms.txt/route');
    const body = await GET().text();
    expect(body).toContain(v2LlmsDescriptor(hide('ai_letter')));
    expect(body).not.toContain('grades SEO and AI readability');
    expect(body).toContain(checkDescription('javascript', hide('nojs')));
  });

  it('Home: LiveHome hides what the switch hides', async () => {
    vi.stubEnv('V2_HIDE_FEATURES', 'nojs');
    const { LiveHome } = await import('../../../components/v2/screens/home/LiveHome');
    const html = renderToStaticMarkup(createElement(LiveHome));
    expect(words(html)).toContain('Homepage');
    expect(words(html)).not.toContain('Text it can read');
  });
});

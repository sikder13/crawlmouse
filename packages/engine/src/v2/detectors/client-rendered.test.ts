/**
 * The JS/SPA gate (OPERATING-RULES §5; CC-20b D8): on a check whose homepage, or one of whose
 * templates, is served for JavaScript to fill in, the crawl cannot prove that a page of it has no
 * link or no short path, so `orphan_pages` and `deep_pages` say `indeterminate` (`client_rendered`)
 * where they would have said `detected`. A verdict proved by a link the crawl did see stands.
 *
 * The site below is the shape the CC-12b staging smoke met on www.alynthe.com: nine routes serving
 * one shell, no link on any of them, every link read. Its pages are `content` here; the built check's
 * classifier would call a shell with no text `thin` (build/client-rendered.test.ts measures that), so
 * these are the shell pages a classifier keeps, which is where the gate is the only protection.
 */
import { describe, expect, it } from 'vitest';
import { site, u, type PageSpec } from '../../../fixtures/v2/detectors/builders.js';
import { detectDeepPages } from './deep-pages.js';
import { detectStructure } from './index.js';
import { detectOrphans } from './orphans.js';
import type { Detection, DetectorInput } from './types.js';

const ROUTES = [
  '/',
  '/about',
  '/services',
  '/contact',
  '/portfolio',
  '/blog',
  '/work/brand-site',
  '/work/shop-rebuild',
  '/work/chat-assistant',
];
const SHELL: PageSpec[] = ROUTES.map((path) => ({ path, links: [] }));
const NOT_HOME = ROUTES.filter((p) => p !== '/');

type Gate = DetectorInput['client_rendered'];
const NONE: Gate = { homepage: false, templates: [] };

const structural = (out: Detection[]) =>
  out.filter((d) => d.type === 'orphan_pages' || d.type === 'deep_pages');
const detected = (out: Detection[]) => structural(out).filter((d) => d.state === 'detected');
const states = (out: Detection[], type: Detection['type']) =>
  Object.fromEntries(
    out.filter((d) => d.type === type).map((d) => [d.key.slice(d.key.indexOf(':') + 1), d]),
  );

describe('the client-rendered gate on a site of one shell (www.alynthe.com, CC-12b)', () => {
  it('control: with no client-rendered signal, every page but the homepage is an orphan and has no path', () => {
    const out = detectStructure(site(SHELL, { clientRendered: NONE }));
    expect(detected(out).map((d) => `${d.type} ${d.affected_urls[0]}`)).toEqual([
      ...NOT_HOME.map((p) => `deep_pages ${u(p)}`).sort(),
      ...NOT_HOME.map((p) => `orphan_pages ${u(p)}`).sort(),
    ]);
  });

  it('with the homepage served for JavaScript to fill in, detects no orphan and no deep page', () => {
    const out = detectStructure(site(SHELL, { clientRendered: { homepage: true, templates: [] } }));
    expect(detected(out)).toEqual([]);
    expect(structural(out)).toHaveLength(2 * NOT_HOME.length);
    for (const d of structural(out)) {
      expect(d, d.key).toMatchObject({ state: 'indeterminate', reason: 'client_rendered' });
    }
  });
});

describe('the gate by template', () => {
  const gate: Gate = { homepage: false, templates: ['/work/{slug}'] };

  it('holds back only the pages of a listed template', () => {
    const input = site(SHELL, { clientRendered: gate });
    const orphans = states(detectOrphans(input), 'orphan_pages');
    const deep = states(detectDeepPages(input), 'deep_pages');
    for (const p of NOT_HOME) {
      const listed = p.startsWith('/work/');
      for (const d of [orphans[u(p)]!, deep[u(p)]!]) {
        expect(d, `${d.key}`).toMatchObject(
          listed
            ? { state: 'indeterminate', reason: 'client_rendered' }
            : { state: 'detected', reason: null },
        );
      }
    }
  });

  it('leaves a verdict a seen link proves: an inbound link, a path within 3 clicks', () => {
    const linked: PageSpec[] = [
      { path: '/', links: ['/work/brand-site'] },
      ...SHELL.filter((s) => s.path !== '/'),
    ];
    const input = site(linked, { clientRendered: gate });
    expect(states(detectOrphans(input), 'orphan_pages')[u('/work/brand-site')]).toMatchObject({
      state: 'not_detected',
      measured: 1,
    });
    expect(states(detectDeepPages(input), 'deep_pages')[u('/work/brand-site')]).toMatchObject({
      state: 'not_detected',
      measured: 1,
    });
  });

  it('names client_rendered before the crawl’s own gaps: the gate is about the page, the gaps about the crawl', () => {
    // The cap is reached, so without the gate these pages read `crawl_truncated`.
    const input = site(SHELL, { clientRendered: gate, cap: ROUTES.length });
    const orphans = states(detectOrphans(input), 'orphan_pages');
    expect(orphans[u('/work/brand-site')]).toMatchObject({ reason: 'client_rendered' });
    expect(orphans[u('/about')]).toMatchObject({ reason: 'crawl_truncated' });
  });

  it('keys on the template, not the path: a listed key that no page carries holds nothing back', () => {
    const out = detectStructure(
      site(SHELL, { clientRendered: { homepage: false, templates: ['/guides/{slug}'] } }),
    );
    expect(detected(out)).toHaveLength(2 * NOT_HOME.length);
  });

  it('leaves the other structure detectors as they were', () => {
    const others = (g: Gate) =>
      detectStructure(site(SHELL, { clientRendered: g })).filter(
        (d) => d.type !== 'orphan_pages' && d.type !== 'deep_pages',
      );
    expect(others({ homepage: true, templates: ['/work/{slug}'] })).toEqual(others(NONE));
  });
});

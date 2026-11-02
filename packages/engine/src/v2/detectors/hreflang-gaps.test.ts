import { describe, expect, it } from 'vitest';
import { site, u } from '../../../fixtures/v2/detectors/builders.js';
import {
  detectHreflangGaps,
  isValidHreflang,
  LANGUAGE_CODES,
  REGION_CODES,
} from './hreflang-gaps.js';
import type { Detection, HreflangLink } from './types.js';

const of = (out: Detection[], path: string) => out.find((d) => d.key === `hreflang:${u(path)}`);
const alt = (lang: string, path: string): HreflangLink => ({ lang, href: u(path) });

/** A complete en/fr cluster with x-default on /en. */
const COMPLETE = {
  en: [alt('en', '/en'), alt('fr', '/fr'), alt('x-default', '/en')],
  fr: [alt('en', '/en'), alt('fr', '/fr'), alt('x-default', '/en')],
};

const cluster = (en: HreflangLink[] | null, fr: HreflangLink[] | null, opts = {}) =>
  site(
    [
      { path: '/', links: ['/en', '/fr'] },
      { path: '/en', facts: { hreflang: en } },
      { path: '/fr', facts: { hreflang: fr } },
    ],
    opts,
  );

describe('hreflang_gap', () => {
  it('is clear on a complete cluster, keyed by its lowest URL', () => {
    const out = detectHreflangGaps(cluster(COMPLETE.en, COMPLETE.fr));
    expect(out).toHaveLength(1);
    expect(of(out, '/en')).toMatchObject({ state: 'not_detected', affected_urls: [] });
  });

  it('reads hreflang hrefs in the engine’s spelling (a trailing slash names the same page)', () => {
    const slashed = (links: HreflangLink[]) => links.map((l) => ({ ...l, href: `${l.href}/` }));
    const out = detectHreflangGaps(cluster(slashed(COMPLETE.en), slashed(COMPLETE.fr)));
    expect(of(out, '/en')).toMatchObject({ state: 'not_detected' });
  });

  it('detects a missing self-reference', () => {
    expect(
      of(
        detectHreflangGaps(cluster(COMPLETE.en, [alt('en', '/en'), alt('x-default', '/en')])),
        '/en',
      ),
    ).toMatchObject({
      state: 'detected',
      conditions: ['hreflang_missing_self'],
      affected_urls: [u('/fr')],
    });
  });

  it('an x-default pointing at the page itself is not its self-reference', () => {
    const onlyDefault = [alt('fr', '/fr'), alt('x-default', '/en')];
    expect(of(detectHreflangGaps(cluster(onlyDefault, COMPLETE.fr)), '/en')).toMatchObject({
      state: 'detected',
      conditions: ['hreflang_missing_self'],
      affected_urls: [u('/en')],
    });
  });

  it('detects missing reciprocity among crawled members (truth vector)', () => {
    // Hand-computed for a three-member cluster: /en and /fr annotate each other and /de; /de
    // annotates only /en. So /fr → /de has no return link; /en → /de does. One missing return, on /fr.
    const full = [alt('en', '/en'), alt('fr', '/fr'), alt('de', '/de'), alt('x-default', '/en')];
    const s = site([
      { path: '/', links: ['/en'] },
      { path: '/en', facts: { hreflang: full } },
      { path: '/fr', facts: { hreflang: full } },
      {
        path: '/de',
        facts: { hreflang: [alt('en', '/en'), alt('de', '/de'), alt('x-default', '/en')] },
      },
    ]);
    const d = of(detectHreflangGaps(s), '/de')!;
    expect(d).toMatchObject({
      state: 'detected',
      conditions: ['hreflang_missing_return'],
      measured: 1,
      affected_urls: [u('/fr')],
    });
  });

  it('detects a missing x-default', () => {
    const noDefault = [alt('en', '/en'), alt('fr', '/fr')];
    expect(of(detectHreflangGaps(cluster(noDefault, COMPLETE.fr)), '/en')).toMatchObject({
      state: 'detected',
      conditions: ['hreflang_missing_x_default'],
      affected_urls: [u('/en')],
    });
  });

  it('detects an invalid language code', () => {
    const uk = [alt('en-UK', '/en'), alt('fr', '/fr'), alt('x-default', '/en')];
    expect(of(detectHreflangGaps(cluster(uk, COMPLETE.fr)), '/en')).toMatchObject({
      state: 'detected',
      conditions: ['hreflang_invalid_code'],
    });
  });

  it('treats a member outside the crawl as unknown, never as missing', () => {
    const withDe = [...COMPLETE.en, alt('de', '/de')];
    const out = detectHreflangGaps(cluster(withDe, [...COMPLETE.fr, alt('de', '/de')]));
    expect(of(out, '/de')).toMatchObject({ state: 'indeterminate', reason: 'member_not_crawled' });
  });

  it('treats a crawled member whose hreflang was not read as outside the crawl', () => {
    expect(of(detectHreflangGaps(cluster(COMPLETE.en, null)), '/en')).toMatchObject({
      state: 'indeterminate',
      reason: 'member_not_crawled',
    });
  });

  it('a proven defect decides even with a member outside the crawl', () => {
    const out = detectHreflangGaps(
      cluster([alt('fr', '/fr'), alt('de', '/de'), alt('x-default', '/en')], COMPLETE.fr),
    );
    expect(of(out, '/de')).toMatchObject({
      state: 'detected',
      conditions: ['hreflang_missing_self'],
    });
  });

  it('a member that answers other than 200 cannot link back', () => {
    const s = site([
      { path: '/', links: ['/en'] },
      { path: '/en', facts: { hreflang: COMPLETE.en } },
      { path: '/fr', status: 404, kind: 'status' },
    ]);
    expect(of(detectHreflangGaps(s), '/en')).toMatchObject({
      state: 'detected',
      conditions: ['hreflang_missing_return'],
    });
  });

  it('on a truncated crawl a clear cluster is indeterminate: an uncrawled page may annotate into it', () => {
    expect(
      of(detectHreflangGaps(cluster(COMPLETE.en, COMPLETE.fr, { cap: 3 })), '/en'),
    ).toMatchObject({
      state: 'indeterminate',
      reason: 'crawl_truncated',
    });
  });

  it('a member that kept its content from us is unknown, not missing its return', () => {
    for (const status of [401, 403, 429, 503]) {
      const s = site([
        { path: '/', links: ['/en'] },
        { path: '/en', facts: { hreflang: COMPLETE.en } },
        { path: '/fr', status, kind: 'status' },
      ]);
      expect(of(detectHreflangGaps(s), '/en'), String(status)).toMatchObject({
        state: 'indeterminate',
        reason: 'member_not_crawled',
      });
    }
  });

  it('annotations read where a request landed are not that page’s own', () => {
    const s = site([
      { path: '/', links: ['/en', '/fr'] },
      { path: '/en', facts: { hreflang: COMPLETE.en } },
      { path: '/fr', facts: { hreflang: COMPLETE.fr, final_url: u('/fr-fr') } },
    ]);
    // /fr redirects, so it cannot annotate back to /en.
    expect(of(detectHreflangGaps(s), '/en')).toMatchObject({
      state: 'detected',
      conditions: ['hreflang_missing_return'],
      affected_urls: [u('/en')],
    });
  });

  it('emits nothing when no page’s hreflang was read', () => {
    expect(detectHreflangGaps(cluster(null, null))).toEqual([]);
  });

  describe('language codes', () => {
    it.each(['en', 'EN-gb', 'fr-CA', 'zh-Hant', 'zh-Hant-TW', 'x-default', 'X-Default'])(
      'accepts %s',
      (c) => expect(isValidHreflang(c)).toBe(true),
    );
    it.each(['en-UK', 'zz', 'eng', 'en_GB', 'en-', '', 'iw', 'fr-EU', 'de-DEU', 'es-419'])(
      'rejects %s',
      (c) => expect(isValidHreflang(c)).toBe(false),
    );

    it('lists codes this runtime’s ICU also knows, and no legacy alias (independent check)', () => {
      const lang = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });
      const region = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
      for (const c of LANGUAGE_CODES) expect(lang.of(c), c).toBeDefined();
      for (const c of REGION_CODES) expect(region.of(c), c).toBeDefined();
      expect(LANGUAGE_CODES.size).toBe(184);
      expect(REGION_CODES.size).toBe(249);
      for (const legacy of ['in', 'iw', 'ji', 'jw', 'mo', 'sh'])
        expect(LANGUAGE_CODES.has(legacy)).toBe(false);
      for (const reserved of ['UK', 'EU', 'UN', 'XK', 'ZZ', 'SU', 'YU'])
        expect(REGION_CODES.has(reserved)).toBe(false);
    });
  });

  it('clusters a site of 400 pages each naming 256 alternates in linear time (about 102,000 URLs)', () => {
    // One href shared by every page joins them all into one cluster.
    const specs = [
      { path: '/', links: [] as string[] },
      ...Array.from({ length: 400 }, (_, i) => ({
        path: `/p${i}`,
        facts: {
          hreflang: [
            { lang: 'en', href: 'https://hub.test/' },
            ...Array.from({ length: 255 }, (_, j) => ({
              lang: 'fr',
              href: `https://x${i}.test/${j}`,
            })),
          ],
        },
      })),
    ];
    const input = site(specs);
    const started = performance.now();
    const out = detectHreflangGaps(input);
    // Measured at about 0.25 s; a copy per URL took 43 s.
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(out).toHaveLength(1);
  }, 30_000);
});

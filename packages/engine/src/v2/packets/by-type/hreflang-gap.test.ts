import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { site, type PageSpec } from '../../../../fixtures/v2/detectors/builders.js';
import { detectHreflangGaps } from '../../detectors/hreflang-gaps.js';
import type { Condition, DetectorInput, HreflangLink } from '../../detectors/types.js';
import { canonicalizeUrl } from '../../../url-canonical.js';
import { NO_STACK, factsFor } from '../test-support/facts.js';
import {
  detected,
  expectDeterministic,
  expectHostileSafe,
  hostile,
  hostileUrl,
  packetOf,
  pageAsRead,
  pageAt,
  seen,
  SERVED,
  servedSite,
} from '../test-support/structure.js';
import { inBothStates, type TwoStateSite } from '../test-support/verify.js';
import type { PacketFacts } from '../types.js';

let served: TwoStateSite | null = null;
afterEach(async () => {
  await served?.close();
  served = null;
});

type Shape = Extract<Condition, `hreflang_${string}`>;
type Links = [lang: string, path: string][];

/** What /de and /en annotate, by the defect the cluster shows; /de is the cluster's lowest URL. */
const BROKEN: Record<Shape, { en: Links; de: Links }> = {
  hreflang_missing_self: {
    en: [
      ['de', '/de'],
      ['x-default', '/en'],
    ],
    de: [
      ['en', '/en'],
      ['de', '/de'],
      ['x-default', '/en'],
    ],
  },
  hreflang_missing_x_default: {
    en: [
      ['en', '/en'],
      ['de', '/de'],
    ],
    de: [
      ['en', '/en'],
      ['de', '/de'],
      ['x-default', '/en'],
    ],
  },
  hreflang_invalid_code: {
    en: [
      ['en-UK', '/en'],
      ['de', '/de'],
      ['x-default', '/en'],
    ],
    de: [
      ['en', '/en'],
      ['de', '/de'],
      ['x-default', '/en'],
    ],
  },
  hreflang_missing_return: {
    en: [
      ['en', '/en'],
      ['x-default', '/en'],
    ],
    de: [
      ['en', '/en'],
      ['de', '/de'],
      ['x-default', '/en'],
    ],
  },
  hreflang_alternate_redirects: {
    en: [
      ['en', '/en'],
      ['de', '/de'],
      ['fr', '/fr'],
      ['x-default', '/en'],
    ],
    de: [
      ['en', '/en'],
      ['de', '/de'],
      ['x-default', '/en'],
    ],
  },
  hreflang_alternate_gone: {
    en: [
      ['en', '/en'],
      ['de', '/de'],
      ['fr', '/fr'],
      ['x-default', '/en'],
    ],
    de: [
      ['en', '/en'],
      ['de', '/de'],
      ['x-default', '/en'],
    ],
  },
};
const FIXED: Links = [
  ['en', '/en'],
  ['de', '/de'],
  ['x-default', '/en'],
];

function cluster(
  base: string,
  shape: Shape,
  over: Partial<{ en: Links; de: Links }> = {},
): DetectorInput {
  const links = (ls: Links): HreflangLink[] =>
    ls.map(([lang, path]) => ({ lang, href: `${base}${path}` }));
  const { en, de } = { ...BROKEN[shape], ...over };
  const fr: PageSpec[] =
    shape === 'hreflang_alternate_redirects'
      ? [{ path: `${base}/fr`, facts: { final_url: `${base}/fr-fr` } }]
      : shape === 'hreflang_alternate_gone'
        ? [{ path: `${base}/fr`, status: 404 }]
        : [];
  return site(
    [
      { path: base, links: [`${base}/en`, `${base}/de`] },
      { path: `${base}/en`, facts: { hreflang: links(en) } },
      { path: `${base}/de`, facts: { hreflang: links(de) } },
      ...fr,
    ],
    { homepage: base },
  );
}

const packetFor = (input: DetectorInput, base: string, stack = NO_STACK) =>
  packetOf(
    'hreflang_gap',
    detected(detectHreflangGaps(input), `${base}/de`),
    factsFor(input, SERVED, stack),
  );

const base = 'https://a.test';
const DOC =
  "Google's rules for hreflang: https://developers.google.com/search/docs/specialty/international/localized-versions";

describe('the hreflang_gap packet', () => {
  it.each<[Shape, string, string]>([
    [
      'hreflang_missing_self',
      'https://a.test/en',
      'It does not list itself among its own annotations under a language code.',
    ],
    [
      'hreflang_missing_x_default',
      'https://a.test/en',
      'It has no x-default annotation. Google recommends one and does not require it.',
    ],
    [
      'hreflang_invalid_code',
      'https://a.test/en',
      'It uses an hreflang value that is not a valid code: `en-UK`.',
    ],
    [
      'hreflang_missing_return',
      'https://a.test/en',
      'It is named as an alternate by another page of the cluster and does not name that page back. Google ignores annotations that do not point both ways.',
    ],
    ['hreflang_alternate_redirects', 'https://a.test/en', 'It names an alternate that redirects.'],
    [
      'hreflang_alternate_gone',
      'https://a.test/en',
      'It names an alternate that answers 404 or 410.',
    ],
  ])('says what %s means, of the one page the record marks', (shape, marked, sentence) => {
    const input = cluster(base, shape);
    const record = detected(detectHreflangGaps(input), `${base}/de`);
    expect(record.conditions).toEqual([shape]);
    expect(record.affected_urls).toEqual([marked]);
    const members = record.evidence.pages.length;
    expect(packetFor(input, base).context).toEqual([
      `The hreflang annotations join \`https://a.test/de\` and ${members - 1} other crawled ${members === 2 ? 'page' : 'pages'} into one cluster. 1 of the ${members} carries a defect: \`${marked}\`.`,
      sentence,
      DOC,
    ]);
  });

  it('does not say which page carries which condition when the record marks more than one', () => {
    const input = cluster(base, 'hreflang_missing_self', {
      de: [
        ['en', '/en'],
        ['de', '/de'],
      ],
    });
    const record = detected(detectHreflangGaps(input), `${base}/de`);
    expect(record.affected_urls).toEqual(['https://a.test/de', 'https://a.test/en']);
    expect(record.conditions).toEqual(['hreflang_missing_self', 'hreflang_missing_x_default']);
    expect(packetFor(input, base).context).toEqual([
      'The hreflang annotations join `https://a.test/de` and 1 other crawled page into one cluster. 2 of the 2 carry a defect: `https://a.test/de`, `https://a.test/en`.',
      'At least one of them does not list itself among its own annotations under a language code.',
      'At least one of them has no x-default annotation. Google recommends one and does not require it.',
      DOC,
    ]);
  });

  it('writes a step for each condition proved, after the rule for the whole cluster', () => {
    const p = packetFor(cluster(base, 'hreflang_invalid_code'), base);
    expect(p.change).toEqual([
      'Give every page of the cluster the same full set of annotations: one <link rel="alternate" hreflang="…" href="…"> in the <head> for each language version, the page itself included, each with an absolute URL.',
      'Write each hreflang value as an ISO 639-1 language code, optionally followed by an ISO 15924 script and an ISO 3166-1 alpha-2 region: en, en-GB, zh-Hant-TW. A region alone is not valid.',
    ]);
    expect(p.keep).toEqual([
      'Keep each page at its URL, and keep the annotations of the pages that carry no defect in step with the ones you change: every page lists the same set.',
    ]);
  });

  it('writes a Next.js body that says where the annotations come from, then the same steps', () => {
    const p = packetFor(cluster(base, 'hreflang_invalid_code'), base);
    expect(p.frameworks).toEqual(['generic', 'nextjs']);
    const next = p.packets[0]!;
    expect(next.change.slice(0, 3)).toEqual([
      'These steps are for the App Router (the app directory). There the annotations come from alternates.languages (a map from hreflang value to URL) in the metadata export, or in generateMetadata, of the page.js of the route or of a layout.js above it.',
      ...p.change,
    ]);
    // setting alternates.languages in a page drops a layout's alternates.canonical: the body says so
    expect(next.change[3]).toContain(
      "carry the layout's alternates.canonical, media and types into the same object",
    );
    expect(next.keep.at(-1)).toBe(
      'Keep the other fields of alternates each page has today (canonical, media, types).',
    );
  });

  it('leaves the x-default step out of the Next.js body, whose cited page shows no such key', () => {
    const only = packetFor(cluster(base, 'hreflang_missing_x_default'), base);
    expect(only.frameworks).toEqual(['generic']);
    expect(only.change.at(-1)).toBe(
      "Add an x-default annotation to each page, naming the page for visitors whose language none of the others matches. Google recommends it and does not require it; the audit's fix stays open until each page has one.",
    );
    const withSelf = packetFor(
      cluster(base, 'hreflang_missing_self', {
        de: [
          ['en', '/en'],
          ['de', '/de'],
        ],
      }),
      base,
    );
    const next = withSelf.packets.find((b) => b.framework === 'nextjs')!;
    expect(next.change.join(' ')).not.toContain('Add an x-default annotation');
    expect(next.change.at(-1)).toBe(
      'The Next.js page cited shows no x-default among the keys of alternates.languages: for that annotation, follow the generic rewrite and confirm the tag in the HTML served.',
    );
  });

  it('asks the command for what the first marked page lacks, read from its own annotations', () => {
    const invalid = packetFor(cluster(base, 'hreflang_invalid_code'), base).verify;
    expect(invalid.command).toMatch(
      /^curl -sS -f --compressed -A '[^']*' -w '[^']*' 'https:\/\/a\.test\/en' \| /,
    );
    expect(invalid.command.endsWith("}' '0' 'https://a.test/en' '0' '1' 'en-UK'")).toBe(true);
    const back = packetFor(cluster(base, 'hreflang_missing_return'), base).verify;
    expect(back.command.endsWith("}' '0' 'https://a.test/en' '1' 'https://a.test/de' '0'")).toBe(
      true,
    );
    expect(back.expect).toBe(
      'Exit status 0 once `https://a.test/en` lists itself under a value with the form of a language code, and carries no value of another form. It must also name `https://a.test/de`. It reads <link> elements in the <head> of the HTML; annotations in an HTTP Link header or a sitemap are not read, no alternate is requested, and a value is checked for its form, not against the registry of codes. An x-default is recommended and not required: the command does not ask for one.',
    );
    const gone = packetFor(cluster(base, 'hreflang_alternate_gone'), base).verify;
    expect(gone.command.endsWith("}' '0' 'https://a.test/en' '0' '1' 'https://a.test/fr'")).toBe(
      true,
    );
    expect(gone.expect).toContain(' It must no longer hold `https://a.test/fr`. ');
  });

  // round 2, SEO finding 3
  it('says in the Next.js body when metadata is sent after the first HTML, and that a value replaces the default list', () => {
    const next = packetFor(cluster(base, 'hreflang_missing_return'), base).packets[0]!;
    expect(next.framework).toBe('nextjs');
    const step = next.change.find((line) => line.includes('htmlLimitedBots'))!;
    expect(step).toContain(
      'When a page cannot be prerendered, or its generateMetadata introduces dynamic behavior, Next.js can send the metadata tags after the first HTML',
    );
    expect(step).toContain(
      'extend the default list: a value for htmlLimitedBots in the Next.js config overrides the default list',
    );
    expect(step).not.toMatch(/waits on data|add the crawler to htmlLimitedBots/);
  });

  it('asks the command for an x-default whenever the record proves one missing, and says why', () => {
    const only = packetFor(cluster(base, 'hreflang_missing_x_default'), base).verify;
    expect(only.command.endsWith("}' '1' 'https://a.test/en' '0' '0'")).toBe(true);
    expect(only.expect).toContain(
      "under a value with the form of a language code and holds an x-default, and carries no value of another form. Google recommends an x-default and does not require one; the audit's fix stays open until an x-default is present, so the command asks for it.",
    );
    expect(only.expect).not.toContain('does not ask for one');
    // with another condition beside it, the x-default is still asked for
    const input = cluster(base, 'hreflang_missing_self', {
      de: [
        ['en', '/en'],
        ['de', '/de'],
      ],
    });
    const more = packetFor(input, base);
    expect(detected(detectHreflangGaps(input), `${base}/de`).conditions).toEqual(
      expect.arrayContaining(['hreflang_missing_self', 'hreflang_missing_x_default']),
    );
    expect(more.verify.command).toContain("}' '1' 'https://a.test/de' '0' '0'");
    // without the condition, it is not
    const none = packetFor(cluster(base, 'hreflang_missing_return'), base).verify;
    expect(none.command).toContain("}' '0' 'https://a.test/en' '1' 'https://a.test/de' '0'");
    expect(none.expect).toContain('the command does not ask for one');
  });

  it('marks no page whose request ended at another address, so the page read answers where it is named', () => {
    // round 2, SEO finding 1: this packet reads a page too, and the detector reads the annotations
    // of a page answering at its own URL only (hreflang-gaps.ts `annotationsOf` here), so the
    // address requested is the page's own
    const input = site(
      [
        {
          path: base,
          links: [`${base}/de`],
          facts: {
            final_url: `${base}/en/`,
            hreflang: [{ lang: 'de', href: `${base}/de` }],
          },
        },
        { path: `${base}/de`, facts: { hreflang: [{ lang: 'en', href: base }] } },
      ],
      { homepage: base },
    );
    const record = detected(detectHreflangGaps(input), base);
    expect(record.affected_urls).toEqual([`${base}/de`]);
    const p = packetOf('hreflang_gap', record, factsFor(input, SERVED));
    expect(p.verify.command).toMatch(
      /^curl -sS -f --compressed -A '[^']*' -w '[^']*' 'https:\/\/a\.test\/de' \| /,
    );
  });

  const head = (ls: Links, origin: string) =>
    `<html><head>${ls
      .map(([lang, path]) => `<link rel="alternate" hreflang="${lang}" href="${origin}${path}">`)
      .join('\n')}</head><body></body></html>`;

  describe.each(Object.keys(BROKEN) as Shape[])('verify, for %s', (shape) => {
    it('fails on the annotations as crawled and passes on the full set', async () => {
      // the pages name the site's own origin, which is known once it listens
      let origin = '';
      served = await servedSite({
        broken: {
          get '/en'() {
            return head(BROKEN[shape].en, origin);
          },
        },
        fixed: {
          get '/en'() {
            return head(FIXED, origin);
          },
        },
      });
      origin = served.base;
      const p = packetFor(cluster(origin, shape), origin);
      const { broken, fixed } = await inBothStates(served, p.verify.command);
      expect(broken.status).not.toBe(0);
      expect(fixed.status).toBe(0);
    });
  });

  // round 2, SEO finding 5: the audit keeps the fix open until the x-default is there
  it('verify, when a return and an x-default are both missing, does not pass on the return alone', async () => {
    const crawled: Links = [['en', '/en']];
    const returned: Links = [
      ['en', '/en'],
      ['de', '/de'],
    ];
    let origin = '';
    let fixedWith = returned;
    served = await servedSite({
      broken: {
        get '/en'() {
          return head(crawled, origin);
        },
      },
      fixed: {
        get '/en'() {
          return head(fixedWith, origin);
        },
      },
    });
    origin = served.base;
    const input = cluster(origin, 'hreflang_missing_return', { en: crawled });
    const record = detected(detectHreflangGaps(input), `${origin}/de`);
    expect(record.conditions).toEqual(
      expect.arrayContaining(['hreflang_missing_return', 'hreflang_missing_x_default']),
    );
    const p = packetFor(input, origin);
    const half = await inBothStates(served, p.verify.command);
    expect(half.broken.status).not.toBe(0);
    expect(half.fixed.status).not.toBe(0);
    // and the detector still flags that state
    const still = cluster(origin, 'hreflang_missing_return', { en: returned });
    expect(detected(detectHreflangGaps(still), `${origin}/de`).conditions).toContain(
      'hreflang_missing_x_default',
    );
    fixedWith = FIXED;
    expect((await inBothStates(served, p.verify.command)).fixed.status).toBe(0);
  });

  it('shows the tags with a command to read, and what it prints today and after', async () => {
    let origin = '';
    served = await servedSite({
      broken: {
        get '/en'() {
          return head(BROKEN.hreflang_missing_return.en, origin);
        },
      },
      fixed: {
        get '/en'() {
          return head(FIXED, origin);
        },
      },
    });
    origin = served.base;
    const p = packetFor(cluster(origin, 'hreflang_missing_return'), origin);
    expect(p.verify.see).toEqual({
      command: expect.stringMatching(
        /^curl -sS -A '[^']*' '[^']*\/en' \| grep -io '<link\[\^>\]\*hreflang\[\^>\]\*>'$/,
      ),
      today: `The page's 2 hreflang tags, as the crawl read them: \`en\` for \`${origin}/en\`, \`x-default\` for \`${origin}/en\`.`,
      after: `A tag that names \`${origin}/en\` under its own language code, a tag for each of \`${origin}/de\`.`,
    });
    const printed = await seen(served, p);
    expect(printed.broken.trim().split('\n')).toHaveLength(2);
    expect(printed.broken).not.toContain(`${origin}/de`);
    expect(printed.fixed).toContain(`hreflang="de" href="${origin}/de"`);
  });

  // the round 1 SEO review's inputs, on a record whose page must name /de back
  const RETURN: Links = [
    ['en', '/en'],
    ['de', '/de'],
  ];
  const tags = (
    ls: Links,
    origin: string,
    write = (lang: string, href: string) =>
      `<link rel="alternate" hreflang="${lang}" href="${href}">`,
  ) => ls.map(([lang, path]) => write(lang, `${origin}${path}`)).join('');
  it.each<[string, (origin: string) => string, boolean]>([
    [
      'the full set without an x-default, which is recommended and not required',
      (o) => `<html><head>${tags(RETURN, o)}</head><body></body></html>`,
      true,
    ],
    [
      'attribute names in upper case',
      (o) =>
        `<html><head>${tags(RETURN, o, (lang, href) => `<LINK REL="alternate" HREFLANG="${lang}" HREF="${href}">`)}</head></html>`,
      true,
    ],
    [
      'the whole set commented out',
      (o) => `<html><head><!-- ${tags(RETURN, o)} --></head><body></body></html>`,
      false,
    ],
    [
      'the set in the <body>',
      (o) => `<html><head></head><body>${tags(RETURN, o)}</body></html>`,
      false,
    ],
    [
      'garbage codes with an x-default to a dead URL',
      (o) =>
        `<html><head>${tags(
          [
            ['english', '/en'],
            ['german', '/de'],
            ['x-default', '/dead'],
          ],
          o,
        )}</head></html>`,
      false,
    ],
  ])('verify, with %s, passes: %s', async (_name, fixedHtml, passes) => {
    let origin = '';
    served = await servedSite({
      broken: {
        get '/en'() {
          return head(BROKEN.hreflang_missing_return.en, origin);
        },
      },
      fixed: {
        get '/en'() {
          return fixedHtml(origin);
        },
      },
    });
    origin = served.base;
    const p = packetFor(cluster(origin, 'hreflang_missing_return'), origin);
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status === 0).toBe(passes);
  });

  it('on a site that serves its pages with a trailing slash, requests the page and reads its annotations as served', async () => {
    const slashed = (ls: Links): Links => ls.map(([lang, path]) => [lang, `${path}/`]);
    let origin = '';
    served = await servedSite({
      broken: {
        get '/en/'() {
          return head(slashed(BROKEN.hreflang_missing_return.en), origin);
        },
      },
      fixed: {
        get '/en/'() {
          return head(slashed(FIXED), origin);
        },
      },
    });
    origin = served.base;
    const input = cluster(origin, 'hreflang_missing_return');
    const facts = factsFor(input, SERVED);
    const pages = new Map(
      [...facts.pages].map(([url, row]) => [
        url,
        url === origin ? row : { ...row, final_url: `${url}/` },
      ]),
    );
    const p = packetOf('hreflang_gap', detected(detectHreflangGaps(input), `${origin}/de`), {
      ...facts,
      pages,
    });
    expect(p.verify.command).toContain(` '${origin}/en/' | `);
    expect(p.verify.expect).toContain(`Exit status 0 once \`${origin}/en/\` lists itself`);
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
  });

  it('agrees with the engine’s own reading of the pages served', async () => {
    let origin = '';
    const en = { broken: BROKEN.hreflang_missing_return.en, fixed: FIXED };
    served = await servedSite({
      broken: {
        get '/en'() {
          return head(en.broken, origin);
        },
      },
      fixed: {
        get '/en'() {
          return head(en.fixed, origin);
        },
      },
    });
    origin = served.base;
    const read = (state: 'broken' | 'fixed') =>
      site(
        [
          { path: origin, links: [`${origin}/en`, `${origin}/de`] },
          pageAsRead(`${origin}/en`, head(en[state], origin)),
          pageAsRead(`${origin}/de`, head(FIXED, origin)),
        ],
        { homepage: origin },
      );
    const p = packetFor(read('broken'), origin);
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
    expect(detectHreflangGaps(read('fixed')).filter((r) => r.state === 'detected')).toEqual([]);
  });
});

describe('the hreflang_gap packet over hostile records (properties)', () => {
  const arb = fc.record({
    members: fc.uniqueArray(hostileUrl(), { minLength: 2, maxLength: 6 }),
    langs: fc.array(hostile(1), { minLength: 1, maxLength: 4 }),
    conditions: fc.subarray<Shape>(Object.keys(BROKEN) as Shape[], { minLength: 1 }),
    framework: fc.constantFrom(null, 'nextjs' as const),
  });
  type Rec = typeof arb extends fc.Arbitrary<infer T> ? T : never;
  const build = ({ members, langs, conditions, framework }: Rec) => {
    // a record holds URLs in the engine's spelling
    const sorted = [...new Set(members.map((m) => canonicalizeUrl(m)))].sort();
    const input = cluster('https://a.test', 'hreflang_missing_self');
    const record = { ...detected(detectHreflangGaps(input), 'https://a.test/de') };
    record.key = `hreflang:${sorted[0]!}`;
    record.conditions = [...conditions].sort();
    record.measured = sorted.length;
    record.affected_urls = sorted;
    record.evidence = { pages: sorted, edges: [] };
    const facts: PacketFacts = {
      ...factsFor(
        input,
        SERVED,
        framework === null
          ? NO_STACK
          : {
              ...NO_STACK,
              frontend: {
                name: 'x',
                framework,
                version: null,
                router: null,
                detected_from: 'a test',
              },
            },
      ),
      // each member names the next one, under a hostile value, and not itself
      pages: new Map(
        sorted.map((url, i) => [
          url,
          pageAt(url, {
            hreflang: {
              links: langs.map((hreflang) => ({
                hreflang,
                href: sorted[(i + 1) % sorted.length]!,
              })),
              complete: true,
            },
          }),
        ]),
      ),
    };
    return { record, facts };
  };

  it('lets nothing crawled out of a code span or a quoted word, and adds no line', () => {
    fc.assert(
      fc.property(arb, (r) => {
        const { record, facts } = build(r);
        expectHostileSafe(packetOf('hreflang_gap', record, facts));
      }),
    );
  });

  it('gives the same packet for the same record and facts', () => {
    fc.assert(
      fc.property(arb, (r) => {
        const { record, facts } = build(r);
        expectDeterministic('hreflang_gap', record, facts);
      }),
    );
  });
});

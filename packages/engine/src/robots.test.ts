import { afterEach, describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  parseRobotsTxt,
  isAllowedByRobots,
  getCrawlDelay,
  isUrlAllowed,
  type ParsedRobots,
} from './robots.js';

const sample = `
User-agent: *
Disallow: /admin/
Disallow: /private
Allow: /private/public

Sitemap: https://example.com/sitemap.xml
Sitemap: https://example.com/sitemap_products.xml
`;

describe('parseRobotsTxt', () => {
  it('extracts sitemap URLs', () => {
    const r = parseRobotsTxt(sample);
    expect(r.sitemaps).toEqual([
      'https://example.com/sitemap.xml',
      'https://example.com/sitemap_products.xml',
    ]);
  });

  it('extracts disallow + allow rules for wildcard UA', () => {
    const r = parseRobotsTxt(sample);
    expect(r.rules['*']?.disallow).toEqual(['/admin/', '/private']);
    expect(r.rules['*']?.allow).toEqual(['/private/public']);
  });
});

describe('isAllowedByRobots', () => {
  const r = parseRobotsTxt(sample);

  it.each([
    ['/products/x', true],
    ['/admin/users', false],
    ['/private', false],
    ['/private/public', true],
  ])('path %s allowed=%s', (path, expected) => {
    expect(isAllowedByRobots(r, 'CrawlmouseBot', path)).toBe(expected);
  });
});

describe('parseRobotsTxt - grouping + BOM edge cases', () => {
  it('shares rules across consecutive user-agent lines', () => {
    const r = parseRobotsTxt('User-agent: GoogleBot\nUser-agent: CrawlmouseBot\nDisallow: /x');
    expect(r.rules['googlebot']?.disallow).toEqual(['/x']);
    expect(r.rules['crawlmousebot']?.disallow).toEqual(['/x']);
  });

  it('attributes directives before any user-agent line to *', () => {
    const r = parseRobotsTxt('Disallow: /pre\nUser-agent: *\nDisallow: /post');
    expect(r.rules['*']?.disallow).toEqual(['/pre', '/post']);
  });

  it('parses despite a leading BOM', () => {
    const r = parseRobotsTxt('\uFEFFUser-agent: *\nDisallow: /x');
    expect(r.rules['*']?.disallow).toEqual(['/x']);
  });
});

describe('Crawl-delay parsing + getCrawlDelay (§5 hard floor)', () => {
  it('parses a wildcard Crawl-delay', () => {
    const r = parseRobotsTxt('User-agent: *\nCrawl-delay: 2\nDisallow: /x');
    expect(r.rules['*']?.crawlDelay).toBe(2);
    // does not disturb allow/disallow parsing
    expect(r.rules['*']?.disallow).toEqual(['/x']);
  });

  it('parses a per-UA Crawl-delay and prefers the specific group over *', () => {
    const r = parseRobotsTxt(
      'User-agent: CrawlmouseBot\nCrawl-delay: 3\nUser-agent: *\nCrawl-delay: 9',
    );
    expect(r.rules['crawlmousebot']?.crawlDelay).toBe(3);
    expect(getCrawlDelay(r, 'CrawlmouseBot')).toBe(3);
  });

  it('falls back to the * group when the UA has no specific group', () => {
    const r = parseRobotsTxt('User-agent: *\nCrawl-delay: 2');
    expect(getCrawlDelay(r, 'CrawlmouseBot')).toBe(2);
  });

  it('does not apply another bot’s Crawl-delay to us', () => {
    const r = parseRobotsTxt('User-agent: GoogleBot\nCrawl-delay: 7');
    expect(getCrawlDelay(r, 'CrawlmouseBot')).toBeUndefined();
  });

  it('ignores a malformed or negative Crawl-delay', () => {
    expect(getCrawlDelay(parseRobotsTxt('User-agent: *\nCrawl-delay: abc'), 'Bot')).toBeUndefined();
    expect(getCrawlDelay(parseRobotsTxt('User-agent: *\nCrawl-delay: -1'), 'Bot')).toBeUndefined();
  });

  it('returns undefined when no Crawl-delay is declared', () => {
    expect(getCrawlDelay(parseRobotsTxt('User-agent: *\nDisallow: /x'), 'Bot')).toBeUndefined();
  });
});

describe('isAllowedByRobots - RFC 9309 wildcards (* and $)', () => {
  const r = parseRobotsTxt(
    'User-agent: *\nDisallow: /*.pdf$\nDisallow: /search\nAllow: /search/help\nDisallow: /a/*/private',
  );

  it.each([
    ['/file.pdf', false, '*.pdf$ matches'],
    ['/file.pdf?download=1', true, '$ anchors the end; query after .pdf is not blocked'],
    ['/search', false, 'prefix disallow'],
    ['/search/help', true, 'more-specific allow wins on a longer match'],
    ['/a/x/private', false, '/a/*/private wildcard segment'],
    ['/a/private', true, 'no middle segment, so the wildcard rule does not match'],
    ['/index.html', true, 'no rule matches'],
  ])('path %s allowed=%s (%s)', (path, expected) => {
    expect(isAllowedByRobots(r, 'Bot', path)).toBe(expected);
  });

  it('is not vulnerable to ReDoS on a heavily-wildcarded rule (attacker robots.txt)', () => {
    // A regex translation (* -> .*) backtracks catastrophically here (~minutes per
    // call). The linear matcher must evaluate a non-matching long path instantly.
    const evil = parseRobotsTxt('User-agent: *\nDisallow: /' + '*a'.repeat(40) + '$');
    const path = '/' + 'a'.repeat(120); // long, ends in 'a' but never satisfies the $ anchor structure
    const start = performance.now();
    const allowed = isAllowedByRobots(evil, 'Bot', path);
    const elapsedMs = performance.now() - start;
    expect(typeof allowed).toBe('boolean');
    expect(elapsedMs).toBeLessThan(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a §4.1 — ONE gate. `isUrlAllowed` is the single predicate every entry path consults, so the
// rule cannot be implemented twice and drift. It takes a whole URL because callers hold URLs, not
// paths, and hand-rolling the path extraction at each call site is how the second rule gets born.
// ─────────────────────────────────────────────────────────────────────────────

describe('isUrlAllowed — the single robots gate (§4.1)', () => {
  const robots = parseRobotsTxt('User-agent: *\nDisallow: /search\nDisallow: /cart\n');

  it('allows everything when the site has no robots.txt', () => {
    expect(isUrlAllowed(null, 'https://x.test/search')).toBe(true);
    expect(isUrlAllowed(undefined, 'https://x.test/search')).toBe(true);
  });

  it('blocks a disallowed path and allows the rest', () => {
    expect(isUrlAllowed(robots, 'https://x.test/search')).toBe(false);
    expect(isUrlAllowed(robots, 'https://x.test/cart')).toBe(false);
    expect(isUrlAllowed(robots, 'https://x.test/ok')).toBe(true);
  });

  it('matches against path AND query, as the enqueue path always did', () => {
    expect(isUrlAllowed(robots, 'https://x.test/search?q=shoes')).toBe(false);
  });

  it('does not block a path that merely contains the rule as a substring', () => {
    expect(isUrlAllowed(robots, 'https://x.test/research')).toBe(true);
    expect(isUrlAllowed(robots, 'https://x.test/a/search')).toBe(true); // rules are start-anchored
  });

  it('allows an unparseable URL rather than throwing — matching the incumbent enqueue behaviour', () => {
    expect(isUrlAllowed(robots, 'not a url')).toBe(true);
  });

  it('uses OUR product token, so a rule aimed at us binds and one aimed elsewhere does not', () => {
    const mine = parseRobotsTxt('User-agent: CrawlmouseBot\nDisallow: /private\n');
    expect(isUrlAllowed(mine, 'https://x.test/private')).toBe(false);
    const theirs = parseRobotsTxt('User-agent: SomeOtherBot\nDisallow: /private\n');
    expect(isUrlAllowed(theirs, 'https://x.test/private')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A User-agent value is text from the audited site. It names a group and nothing else: it must not
// resolve to a property that `Object.prototype` (or the `Object` function) already carries.
//
// Before the fix, groups lived in a plain `{}`. `User-agent: __proto__` + `Crawl-delay: 1` wrote
// `Object.prototype.crawlDelay = 1`, which later groups with no Crawl-delay of their own then inherited —
// on a warm function instance, one site set the crawl delay for audits of other sites that followed it. `User-agent: constructor` +
// `Crawl-delay` wrote onto `Object` itself, and either name followed by `Disallow`/`Allow` threw.
//
// The sweep varies what the bug keys on: the NAME (the list below is read from the runtime, not typed
// out), its CASING (the parser lower-cases, so only all-lower-case names reach a prototype today — the
// fix must not depend on that), the DIRECTIVE, and whether the group is SHARED with another User-agent.
// ─────────────────────────────────────────────────────────────────────────────

const INHERITED_NAMES = Object.getOwnPropertyNames(Object.prototype);
const PROTO_OWN_NAMES = [...INHERITED_NAMES].sort();
const OBJECT_OWN_NAMES = Object.getOwnPropertyNames(Object).sort();

const CASINGS: ReadonlyArray<readonly [string, (s: string) => string]> = [
  ['as-is', (s) => s],
  ['lower', (s) => s.toLowerCase()],
  ['upper', (s) => s.toUpperCase()],
  [
    'alternating',
    (s) => [...s].map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase())).join(''),
  ],
];

const HOSTILE_AGENTS = INHERITED_NAMES.flatMap((name) =>
  CASINGS.map(([casing, apply]) => ({ name, casing, agent: apply(name) })),
);

type Group = { disallow: string[]; allow: string[]; crawlDelay?: number };
const DIRECTIVES: ReadonlyArray<{ directive: string; line: string; group: Group }> = [
  {
    directive: 'Disallow',
    line: 'Disallow: /hostile',
    group: { disallow: ['/hostile'], allow: [] },
  },
  { directive: 'Allow', line: 'Allow: /hostile', group: { disallow: [], allow: ['/hostile'] } },
  {
    directive: 'Crawl-delay',
    line: 'Crawl-delay: 11',
    group: { disallow: [], allow: [], crawlDelay: 11 },
  },
];

const SWEEP = HOSTILE_AGENTS.flatMap((a) => DIRECTIVES.map((d) => ({ ...a, ...d })));

/** Nothing was added to Object.prototype or to Object, and a fresh object inherits no delay. */
function expectGlobalsUntouched(): void {
  expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(PROTO_OWN_NAMES);
  expect(Object.getOwnPropertyNames(Object).sort()).toEqual(OBJECT_OWN_NAMES);
  expect(({} as { crawlDelay?: unknown }).crawlDelay).toBeUndefined();
}

/** Deletes whatever was added to Object.prototype or Object since this module loaded. */
function scrubGlobals(): void {
  for (const n of Object.getOwnPropertyNames(Object.prototype)) {
    if (!PROTO_OWN_NAMES.includes(n)) delete (Object.prototype as Record<string, unknown>)[n];
  }
  for (const n of Object.getOwnPropertyNames(Object)) {
    if (!OBJECT_OWN_NAMES.includes(n)) delete (Object as unknown as Record<string, unknown>)[n];
  }
}

/** The group stored under `key`, read as an OWN property only. */
function ownGroup(robots: ParsedRobots, key: string): unknown {
  return Object.hasOwn(robots.rules, key) ? robots.rules[key] : undefined;
}

describe('User-agent values that name inherited properties', () => {
  // Scrub anything a failing case added, so a regression reddens the case that caused it and not the
  // unrelated tests that run after it in this worker.
  afterEach(scrubGlobals);

  it('sweeps the two names that reach a prototype today, so the sweep is not vacuous', () => {
    expect(INHERITED_NAMES).toEqual(expect.arrayContaining(['__proto__', 'constructor']));
  });

  it.each(SWEEP)(
    'own group: $name ($casing) + $directive parses, touches no global, and the other groups still apply',
    ({ agent, line, group }) => {
      const robots = parseRobotsTxt(
        [
          `User-agent: ${agent}`,
          line,
          '',
          'User-agent: *',
          'Disallow: /private',
          'Crawl-delay: 3',
          '',
          'User-agent: CrawlmouseBot',
          'Disallow: /mine',
        ].join('\n'),
      );

      expectGlobalsUntouched();
      // The hostile name is an ordinary group holding exactly what was written under it.
      expect(ownGroup(robots, agent.toLowerCase())).toEqual(group);
      expect(isAllowedByRobots(robots, agent, '/hostile')).toBe(line !== 'Disallow: /hostile');
      expect(getCrawlDelay(robots, agent)).toBe(group.crawlDelay);
      // `*` binds a crawler with no group of its own.
      expect(isAllowedByRobots(robots, 'SomeBot', '/private')).toBe(false);
      expect(isAllowedByRobots(robots, 'SomeBot', '/ok')).toBe(true);
      expect(getCrawlDelay(robots, 'SomeBot')).toBe(3);
      // Our own group binds us, declares no delay, and does not fall through to `*`.
      expect(isUrlAllowed(robots, 'https://x.test/mine')).toBe(false);
      expect(isUrlAllowed(robots, 'https://x.test/private')).toBe(true);
      expect(isUrlAllowed(robots, 'https://x.test/hostile')).toBe(true);
      expect(getCrawlDelay(robots, 'CrawlmouseBot')).toBeUndefined();
    },
  );

  it.each(SWEEP)(
    'shared group: $name ($casing) + CrawlmouseBot + $directive applies to both, touches no global',
    ({ agent, line, group }) => {
      const robots = parseRobotsTxt(
        [
          `User-agent: ${agent}`,
          'User-agent: CrawlmouseBot',
          line,
          '',
          'User-agent: *',
          'Disallow: /private',
          'Crawl-delay: 3',
        ].join('\n'),
      );

      expectGlobalsUntouched();
      expect(ownGroup(robots, agent.toLowerCase())).toEqual(group);
      expect(ownGroup(robots, 'crawlmousebot')).toEqual(group);
      expect(isUrlAllowed(robots, 'https://x.test/hostile')).toBe(line !== 'Disallow: /hostile');
      expect(getCrawlDelay(robots, 'CrawlmouseBot')).toBe(group.crawlDelay);
      expect(isAllowedByRobots(robots, 'SomeBot', '/private')).toBe(false);
      expect(getCrawlDelay(robots, 'SomeBot')).toBe(3);
    },
  );

  // The lookups are exported and take any ParsedRobots, including ones the parser did not build: the
  // cf-panel script passes an object literal, and a ParsedRobots that went through JSON comes back as
  // a plain object. A lookup by an inherited name must still reach only the file's own groups.
  const STAR_ONLY = 'User-agent: *\nDisallow: /private\nCrawl-delay: 3\n';
  const SHAPES: ReadonlyArray<readonly [string, () => ParsedRobots]> = [
    ['parsed', () => parseRobotsTxt(STAR_ONLY)],
    [
      'object literal',
      () => ({
        sitemaps: [],
        rules: { '*': { disallow: ['/private'], allow: [], crawlDelay: 3 } },
      }),
    ],
    [
      'JSON round-trip',
      () => JSON.parse(JSON.stringify(parseRobotsTxt(STAR_ONLY))) as ParsedRobots,
    ],
  ];
  const LOOKUPS = SHAPES.flatMap(([shape, make]) =>
    HOSTILE_AGENTS.map((a) => ({ shape, make, ...a })),
  );

  it.each(LOOKUPS)(
    'lookup by $name ($casing) on a $shape ParsedRobots falls through to `*` without throwing',
    ({ make, agent }) => {
      const robots = make();
      expect(isAllowedByRobots(robots, agent, '/private')).toBe(false);
      expect(isAllowedByRobots(robots, agent, '/ok')).toBe(true);
      expect(getCrawlDelay(robots, agent)).toBe(3);
    },
  );

  it('a JSON round-trip of a file naming __proto__ and constructor still resolves each group', () => {
    const file = [
      'User-agent: __proto__',
      'Disallow: /a',
      '',
      'User-agent: constructor',
      'Crawl-delay: 9',
      '',
      'User-agent: *',
      'Disallow: /private',
    ].join('\n');
    const robots = JSON.parse(JSON.stringify(parseRobotsTxt(file))) as ParsedRobots;
    expect(isAllowedByRobots(robots, '__proto__', '/a')).toBe(false);
    expect(getCrawlDelay(robots, 'constructor')).toBe(9);
    expect(isAllowedByRobots(robots, 'SomeBot', '/private')).toBe(false);
    expect(getCrawlDelay(robots, 'SomeBot')).toBeUndefined();
    expectGlobalsUntouched();
  });

  it('property: no generated robots.txt throws or adds to Object.prototype or Object', () => {
    const casing = fc.constantFrom(...CASINGS.map(([, apply]) => apply));
    const inherited = fc
      .tuple(fc.constantFrom(...INHERITED_NAMES), casing)
      .map(([n, apply]) => apply(n));
    const agent = fc.oneof(
      inherited,
      fc.constantFrom('*', 'CrawlmouseBot', 'GPTBot'),
      fc.stringMatching(/^[A-Za-z_-]{1,12}$/),
    );
    const path = fc.constantFrom('', '/', '/a', '/b*', '/c$', '/*.pdf$');
    const line = fc.oneof(
      agent.map((a) => `User-agent: ${a}`),
      path.map((p) => `Disallow: ${p}`),
      path.map((p) => `Allow: ${p}`),
      fc.constantFrom('0', '1', '2.5', '-1', 'abc').map((d) => `Crawl-delay: ${d}`),
      fc.constantFrom('', '# comment', 'Sitemap: https://x.test/s.xml'),
    );

    fc.assert(
      fc.property(fc.array(line, { maxLength: 30 }), agent, (lines, probe) => {
        // Each run starts clean, so a shrunk counterexample is one that pollutes by itself.
        scrubGlobals();
        const robots = parseRobotsTxt(lines.join('\n'));
        for (const ua of [probe, 'CrawlmouseBot', '*']) {
          isAllowedByRobots(robots, ua, '/a');
          getCrawlDelay(robots, ua);
        }
        isUrlAllowed(robots, 'https://x.test/a');
        expectGlobalsUntouched();
      }),
      { numRuns: 500 },
    );
  });
});

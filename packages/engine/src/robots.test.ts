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
// `Object.prototype.crawlDelay = 1`, which later groups with no Crawl-delay of their own then inherited.
// On a warm function instance, one site could set the crawl delay that the polite (v2) crawl honours for
// audits of other sites after it. `User-agent: constructor` + `Crawl-delay` wrote onto `Object` itself,
// and either name followed by `Disallow`/`Allow` threw.
//
// The sweep varies what the bug keys on: the NAME (the list below is read from the runtime, not typed
// out), its CASING, the DIRECTIVE, and whether the group is SHARED with another User-agent. The parser
// lower-cases, so today only the all-lower-case names reach a prototype (the first test pins which).
// The fix must not lean on that, so the storage's missing prototype is asserted directly as well.
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
  // Cases that parse or look up assert the globals themselves. This scrub keeps a failure in one of them
  // from spreading to the tests that run after it in this worker.
  afterEach(scrubGlobals);

  it('the names that reach a prototype through a lower-cased key are exactly __proto__ and constructor', () => {
    expect(INHERITED_NAMES.filter((n) => n === n.toLowerCase()).sort()).toEqual([
      '__proto__',
      'constructor',
    ]);
  });

  it('stores groups in an object with no prototype, so no key reaches one whatever its casing', () => {
    const robots = parseRobotsTxt('User-agent: *\nDisallow: /x\n');
    expect(Object.getPrototypeOf(robots.rules)).toBeNull();
    expectGlobalsUntouched();
  });

  it.each(SWEEP)(
    'own group: $name ($casing) + $directive parses, adds nothing to Object.prototype or Object, and the other groups still apply',
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
    'shared group: $name ($casing) + CrawlmouseBot + $directive applies to both, adds nothing to Object.prototype or Object',
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
      expectGlobalsUntouched();
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

// ─────────────────────────────────────────────────────────────────────────────
// Parse cost, storage, the 500 KiB limit and line endings. robots.txt comes from the audited site, so
// its shape is chosen by whoever we are auditing.
//
// Before this change, three shapes made the parse slow or large (measured in the PR that added these
// tests):
// - Each rule was copied to every agent in its group: N agents × M rules.
// - The comment and directive regexes backtracked quadratically on a lone CR, U+2028 or U+2029.
// - No size limit: the fetch allows 10 MB.
// The bound tests below vary the shape that triggers each one: agents per group, agents in several
// groups, rule kind, the character the regexes could not cross, and the bytes around the limit.
// ─────────────────────────────────────────────────────────────────────────────

/** RFC 9309 §2.5: a parser must read at least 500 KiB. Written out here, not imported from robots.ts. */
const LIMIT = 500 * 1024;
const utf8Bytes = (s: string): number => Buffer.byteLength(s, 'utf8');

function timedParse(text: string): { ms: number; robots: ParsedRobots } {
  const t0 = performance.now();
  const robots = parseRobotsTxt(text);
  return { ms: performance.now() - t0, robots };
}

/** Rule lines held across distinct stored group objects. Reading a key runs its getter, if any. */
function storedRuleEntries(robots: ParsedRobots): number {
  const distinct = new Set(Object.keys(robots.rules).map((k) => robots.rules[k]!));
  let n = 0;
  for (const g of distinct) n += g.disallow.length + g.allow.length;
  return n;
}

/**
 * Parses `make(32 KiB)` and then `make(500 KiB)`, each under a wall-clock bound. The small size runs
 * first, so a quadratic parser fails within seconds instead of running for minutes at full size.
 */
function expectBoundedParse(make: (bytes: number) => string): void {
  for (const [size, boundMs] of [
    [32 * 1024, 200],
    [LIMIT, 2000],
  ] as const) {
    const text = make(size);
    expect(utf8Bytes(text)).toBe(size);
    expect(timedParse(text).ms).toBeLessThan(boundMs);
  }
}

/** `agents` User-agent lines forming one group, then `rule(i)` lines while the file fits in LIMIT. */
function oneGroupFile(agents: number, rule: (i: number) => string) {
  const head = Array.from({ length: agents }, (_, i) => `User-agent: bot${i}\n`).join('');
  let used = utf8Bytes(head);
  const lines: string[] = [];
  for (let i = 0; ; i++) {
    const line = `${rule(i)}\n`;
    if (used + line.length > LIMIT) break;
    lines.push(line);
    used += line.length;
  }
  return { text: head + lines.join(''), ruleLines: lines.length };
}

/**
 * Every agent in one big group, then each agent again in a one-rule group of its own, so no two agents
 * share a combination. Short lines, so agents × big-group rules is close to the most 500 KiB can hold.
 */
function everyAgentInTwoGroupsFile(agents: number) {
  const id = (i: number) => i.toString(36);
  const big = Array.from({ length: agents }, (_, i) => `User-agent:${id(i)}\n`).join('');
  // Own paths start "/-", which no big-group path does.
  const own = Array.from(
    { length: agents },
    (_, i) => `User-agent:${id(i)}\nDisallow:/-${id(i)}\n`,
  ).join('');
  let budget = LIMIT - utf8Bytes(big) - utf8Bytes(own);
  const bigPaths: string[] = [];
  for (let i = 0; ; i++) {
    const path = `/${id(i)}`;
    const line = `Allow:${path}\n`;
    if (line.length > budget) break;
    bigPaths.push(path);
    budget -= line.length;
  }
  const text = big + bigPaths.map((p) => `Allow:${p}\n`).join('') + own;
  return { text, bigPaths, id };
}

// The CC-12 review's test alphabet (#, space, colon, letters, CR, LF, U+2028, U+2029), plus '-', '/',
// '*' and whole directive names, so that some generated lines are directives. Used by the differential
// property below. Random text over it parses quickly on the previous parser too, so parse time is
// bounded with the worst-case shapes instead.
const CC12_ALPHABET = [
  '#',
  ' ',
  ':',
  'a',
  'Z',
  '-',
  '/',
  '*',
  '\r',
  '\n',
  '\u2028',
  '\u2029',
  'Disallow',
  'Allow',
  'User-agent',
  'Crawl-delay',
  'Sitemap',
];

describe('parse cost and storage are linear in the file', () => {
  it('a 500 KiB file with 5,000 agents in one group parses within the bound and stores the group once', () => {
    const { text, ruleLines } = oneGroupFile(5000, (i) => `Disallow: /p${i}`);
    expect(utf8Bytes(text)).toBeGreaterThan(LIMIT - 32);
    const { ms, robots } = timedParse(text);
    expect(ms).toBeLessThan(2000);

    const values = Object.keys(robots.rules).map((k) => robots.rules[k]);
    expect(values).toHaveLength(5000);
    expect(new Set(values).size).toBe(1);
    expect(storedRuleEntries(robots)).toBe(ruleLines);
    expect(isAllowedByRobots(robots, 'BOT4999', `/p${ruleLines - 1}`)).toBe(false);
    expect(isAllowedByRobots(robots, 'bot0', '/q')).toBe(true);
  });

  it('the same file shape of Crawl-delay lines parses within the bound and stores the group once', () => {
    const { text, ruleLines } = oneGroupFile(5000, (i) => `Crawl-delay: ${i % 10}`);
    expect(utf8Bytes(text)).toBeGreaterThan(LIMIT - 32);
    const { ms, robots } = timedParse(text);
    expect(ms).toBeLessThan(2000);

    const values = Object.keys(robots.rules).map((k) => robots.rules[k]);
    expect(values).toHaveLength(5000);
    expect(new Set(values).size).toBe(1);
    expect(storedRuleEntries(robots)).toBe(0);
    expect(getCrawlDelay(robots, 'bot17')).toBe((ruleLines - 1) % 10);
  });

  it('a 500 KiB file of nothing but User-agent lines in one group parses within a tighter bound', () => {
    // Over 30,000 agents in one group. Checking each new agent against a list of the group's agents,
    // rather than a set, is quadratic in the agents; this bound is tighter than the 2 s used elsewhere
    // so that such a check fails it.
    const id = (i: number) => i.toString(36);
    const lines: string[] = [];
    let used = 0;
    for (let i = 0; ; i++) {
      const line = `User-agent:${id(i)}\n`;
      if (used + line.length > LIMIT - 16) break;
      lines.push(line);
      used += line.length;
    }
    expect(lines.length).toBeGreaterThan(30_000);
    const { ms, robots } = timedParse(lines.join('') + 'Disallow:/\n');
    expect(ms).toBeLessThan(1000);
    expect(Object.keys(robots.rules)).toHaveLength(lines.length);
    expect(isAllowedByRobots(robots, id(lines.length - 1), '/x')).toBe(false);
  });

  it('agents that are each in a big group and a group of their own parse and look up within the bound', () => {
    const agents = 6000;
    const { text, bigPaths, id } = everyAgentInTwoGroupsFile(agents);
    expect(utf8Bytes(text)).toBeGreaterThan(LIMIT - 32);
    expect(bigPaths.length).toBeGreaterThan(20_000);

    const t0 = performance.now();
    const robots = parseRobotsTxt(text);
    const a = robots.rules[id(42)];
    const ownPathBlocked = !isAllowedByRobots(robots, id(43).toUpperCase(), `/-${id(43)}`);
    const otherPathAllowed = isAllowedByRobots(robots, id(43), `/-${id(42)}`);
    const ms = performance.now() - t0;
    // Tighter than the 2 s used above: combining every agent at parse time instead of on first read
    // is the regression this shape exists to catch, and it misses a 2 s bound by less.
    expect(ms).toBeLessThan(1000);

    expect(Object.keys(robots.rules)).toHaveLength(agents);
    expect(a).toEqual({ disallow: [`/-${id(42)}`], allow: bigPaths });
    expect(ownPathBlocked).toBe(true);
    expect(otherPathAllowed).toBe(true);
  });

  it('agents named in the same set of groups share one combination', () => {
    const robots = parseRobotsTxt(
      'User-agent: a\nUser-agent: b\nDisallow: /1\n\nUser-agent: a\nUser-agent: b\nDisallow: /2\n',
    );
    expect(robots.rules['a']).toEqual({ disallow: ['/1', '/2'], allow: [] });
    expect(robots.rules['a']).toBe(robots.rules['b']);
  });

  it.each([
    ['x', 'y'],
    ['y', 'x'],
  ])(
    'agents in different sets of groups get their own combination, whichever is read first (%s)',
    (first, second) => {
      // x is in groups 1, 2 and 3; y in groups 1 and 23. Written without a separator, both lists read
      // "123", so a combination cache keyed that way would hand one agent the other's rules.
      const lines: string[] = [];
      for (let g = 0; g < 30; g++) {
        lines.push(`User-agent: g${g}`);
        if ([1, 2, 3].includes(g)) lines.push('User-agent: x');
        if ([1, 23].includes(g)) lines.push('User-agent: y');
        lines.push(`Disallow: /g${g}`);
      }
      const robots = parseRobotsTxt(lines.join('\n'));
      const read = { [first!]: robots.rules[first!], [second!]: robots.rules[second!] };
      expect(read['x']).toEqual({ disallow: ['/g1', '/g2', '/g3'], allow: [] });
      expect(read['y']).toEqual({ disallow: ['/g1', '/g23'], allow: [] });
    },
  );

  const QUADRATIC_SHAPES: ReadonlyArray<readonly [string, (bytes: number) => string]> = [
    ['a run of # then a lone CR', (n) => '#'.repeat(n - 2) + '\rx'],
    ['a run of # then U+2028', (n) => '#'.repeat(n - 4) + '\u2028x'],
    ['a run of # then U+2029', (n) => '#'.repeat(n - 4) + '\u2029x'],
    ['"a:", spaces, then lone CRs', (n) => 'a:' + ' '.repeat(n - 6) + '\rx\ry'],
    ['"a:", spaces, then U+2028', (n) => 'a:' + ' '.repeat(n - 10) + '\u2028x\u2028y'],
    ['"a:", spaces, then U+2029', (n) => 'a:' + ' '.repeat(n - 10) + '\u2029x\u2029y'],
    // Not slow on the previous parser either: it catches a regex trim of the value, which backtracks
    // on whitespace in the middle of a line.
    ['"a:a", spaces, then "b"', (n) => 'a:a' + ' '.repeat(n - 4) + 'b'],
  ];

  it.each(QUADRATIC_SHAPES)('%s: parses at 32 KiB and at 500 KiB within the bound', (_, make) => {
    expectBoundedParse(make);
  });
});

describe('the 500 KiB parse limit', () => {
  /** Comment lines of exactly `n` UTF-8 bytes in total, each ending in `eol`. */
  function filler(n: number, eol = '\n'): string {
    const line = '#' + 'x'.repeat(99 - eol.length) + eol; // 100 bytes
    let count = Math.floor(n / 100);
    let rem = n % 100;
    if (rem > 0 && rem < eol.length) {
      count -= 1;
      rem += 100;
    }
    return line.repeat(count) + (rem === 0 ? '' : '#'.repeat(rem - eol.length) + eol);
  }
  const EOLS = ['\n', '\r\n', '\r'];
  const HEAD = 'User-agent: *\nDisallow: /first\n';
  /** `head`, then filler, then `tail` starting at byte offset `at`. */
  const fileWithTailAt = (at: number, tail: string, head = HEAD, eol = '\n') =>
    head + filler(at - utf8Bytes(head), eol) + tail;

  it('a file of exactly 500 KiB is read to its last byte', () => {
    const tail = 'Disallow: /last';
    const text = fileWithTailAt(LIMIT - utf8Bytes(tail), tail);
    expect(utf8Bytes(text)).toBe(LIMIT);
    expect(parseRobotsTxt(text).rules['*']!.disallow).toEqual(['/first', '/last']);
  });

  it('a leading BOM is not counted toward the limit', () => {
    const tail = 'Disallow: /last';
    const text = '\uFEFF' + fileWithTailAt(LIMIT - utf8Bytes(tail), tail);
    expect(parseRobotsTxt(text).rules['*']!.disallow).toEqual(['/first', '/last']);
  });

  it.each(EOLS)('a rule that starts past the limit is ignored (line end %j)', (eol) => {
    const head = `User-agent: *${eol}Disallow: /first${eol}`;
    const text = fileWithTailAt(LIMIT, `Disallow: /beyond${eol}`, head, eol);
    expect(parseRobotsTxt(text).rules['*']!.disallow).toEqual(['/first']);
  });

  it.each(EOLS)('a line the limit cuts is dropped whole (line end %j)', (eol) => {
    // The limit falls between "/last" and "X".
    const head = `User-agent: *${eol}Disallow: /first${eol}`;
    const at = LIMIT - utf8Bytes('Disallow: /last');
    const text = fileWithTailAt(at, `Disallow: /lastX${eol}`, head, eol);
    expect(utf8Bytes(text)).toBe(LIMIT + 1 + eol.length);
    expect(parseRobotsTxt(text).rules['*']!.disallow).toEqual(['/first']);
  });

  it.each(EOLS)('a cut Allow line cannot widen what is allowed (line end %j)', (eol) => {
    // Kept, the cut line would read "Allow: /p" and allow /private. Dropping the lines before it as
    // well would leave no rules at all, which allows everything.
    const head = `User-agent: *${eol}Disallow: /${eol}`;
    const at = LIMIT - utf8Bytes('Allow: /p');
    const text = fileWithTailAt(at, `Allow: /public/page${eol}`, head, eol);
    const robots = parseRobotsTxt(text);
    expect(robots.rules['*']).toEqual({ disallow: ['/'], allow: [] });
    expect(isAllowedByRobots(robots, 'Bot', '/private')).toBe(false);
    expect(isAllowedByRobots(robots, 'Bot', '/public/page')).toBe(false);
  });

  it.each(['\n', '\r\n', '\r'])(
    'a line that ends exactly at the limit is kept (line end %j)',
    (eol) => {
      const line = 'Disallow: /edge';
      const text = fileWithTailAt(LIMIT - utf8Bytes(line), `${line}${eol}Disallow: /beyond`);
      expect(parseRobotsTxt(text).rules['*']!.disallow).toEqual(['/first', '/edge']);
    },
  );

  it.each([
    ['€', 1],
    ['€', 2],
    ['😀', 1],
    ['😀', 2],
    ['😀', 3],
  ])('a %s cut by the limit with %i byte(s) before it drops only its own line', (char, before) => {
    // Kept as far as the limit, the last line would read "Disallow: /", which blocks everything.
    const lead = 'Disallow: /before\nDisallow: /';
    const text = fileWithTailAt(LIMIT - before - utf8Bytes(lead), `${lead}${char}uro\n`);
    const robots = parseRobotsTxt(text);
    expect(robots.rules['*']!.disallow).toEqual(['/first', '/before']);
    expect(isAllowedByRobots(robots, 'Bot', '/anything')).toBe(true);
  });

  it('a file over the limit only in UTF-8 bytes, not in characters, is cut at 500 KiB of UTF-8', () => {
    // Comment lines of 100 bytes but 36 characters each, so the whole file is far shorter than
    // 500 KiB in UTF-16 code units.
    const line = '###' + '€'.repeat(32) + '\n';
    const edge = 'Disallow: /edge';
    const fill = LIMIT - utf8Bytes(HEAD) - utf8Bytes(edge);
    const text =
      HEAD +
      line.repeat(Math.floor(fill / 100)) +
      filler(fill % 100) +
      edge +
      '\nDisallow: /beyond\n';
    expect(text.length).toBeLessThan(LIMIT / 2);
    expect(parseRobotsTxt(text).rules['*']!.disallow).toEqual(['/first', '/edge']);
  });

  it('a multi-byte character that ends exactly at the limit keeps its line', () => {
    const line = 'Disallow: /€';
    const text = fileWithTailAt(LIMIT - utf8Bytes(line), `${line}\nDisallow: /beyond`);
    expect(parseRobotsTxt(text).rules['*']!.disallow).toEqual(['/first', '/€']);
  });
});

describe('line endings', () => {
  const LF =
    'User-agent: *\nDisallow: /a\nCrawl-delay: 2\n\nUser-agent: CrawlmouseBot\nAllow: /b\nDisallow: /\nSitemap: https://x.test/s.xml\n';
  const FORMS: ReadonlyArray<readonly [string, string]> = [
    ['LF', LF],
    ['CRLF', LF.replaceAll('\n', '\r\n')],
    ['CR', LF.replaceAll('\n', '\r')],
    [
      'mixed',
      LF.split('\n')
        .map((l, i) => l + ['\r\n', '\r', '\n'][i % 3])
        .join(''),
    ],
  ];

  it.each(FORMS)('a %s file gives the same groups', (_, text) => {
    const robots = parseRobotsTxt(text);
    expect(robots.sitemaps).toEqual(['https://x.test/s.xml']);
    expect(Object.keys(robots.rules)).toEqual(['*', 'crawlmousebot']);
    expect(robots.rules['*']).toEqual({ disallow: ['/a'], allow: [], crawlDelay: 2 });
    expect(robots.rules['crawlmousebot']).toEqual({ disallow: ['/'], allow: ['/b'] });
  });

  it('U+2028 and U+2029 inside a value are part of the value, not line ends', () => {
    const robots = parseRobotsTxt(
      'User-agent: *\nDisallow: /a\u2028b # note\nDisallow: /c\u2029d\nDisallow: /e\n',
    );
    expect(robots.rules['*']!.disallow).toEqual(['/a\u2028b', '/c\u2029d', '/e']);
  });

  it('a lone CR in the middle of an LF file ends a line', () => {
    const robots = parseRobotsTxt('User-agent: *\nDisallow: /a\rDisallow: /b\n');
    expect(robots.rules['*']!.disallow).toEqual(['/a', '/b']);
  });

  it('a CR between the colon and the value ends the line, leaving an empty Disallow', () => {
    // The previous parser skipped this CR as whitespace and read "Disallow: /a".
    const robots = parseRobotsTxt('User-agent: *\nDisallow:\r/a\n');
    expect(robots.rules['*']).toEqual({ disallow: [], allow: [] });
    expect(isAllowedByRobots(robots, 'Bot', '/a')).toBe(true);
  });

  it('U+2028 or U+2029 after a # is part of the comment', () => {
    const robots = parseRobotsTxt(
      'User-agent: *\nDisallow: /a # note\u2028more\nDisallow: /b # x\u2029 # y\n',
    );
    expect(robots.rules['*']!.disallow).toEqual(['/a', '/b']);
  });

  it('a User-agent value containing U+2028 names its own group, so the next rules go to it', () => {
    const robots = parseRobotsTxt(
      'User-agent: CrawlmouseBot\nDisallow: /x\nUser-agent: foo\u2028bar\nDisallow: /\n',
    );
    expect(robots.rules['crawlmousebot']).toEqual({ disallow: ['/x'], allow: [] });
    expect(robots.rules['foo\u2028bar']).toEqual({ disallow: ['/'], allow: [] });
    expect(isUrlAllowed(robots, 'https://x.test/page')).toBe(true);
  });

  it('U+2028 between two directives does not start a new line', () => {
    const robots = parseRobotsTxt('User-agent: *\u2028Disallow: /x\n');
    expect(isAllowedByRobots(robots, 'Bot', '/x')).toBe(true);
  });
});

describe('RFC 9309 grouping, kept as it was', () => {
  it('an agent named in several groups gets their rules combined in file order', () => {
    const robots = parseRobotsTxt(
      [
        'User-agent: a',
        'Disallow: /1',
        'Crawl-delay: 5',
        '',
        'User-agent: b',
        'Disallow: /2',
        '',
        'User-agent: a',
        'User-agent: c',
        'Allow: /3',
        'Disallow: /4',
      ].join('\n'),
    );
    expect(Object.keys(robots.rules)).toEqual(['a', 'b', 'c']);
    expect(robots.rules['a']).toEqual({ disallow: ['/1', '/4'], allow: ['/3'], crawlDelay: 5 });
    expect(robots.rules['b']).toEqual({ disallow: ['/2'], allow: [] });
    expect(robots.rules['c']).toEqual({ disallow: ['/4'], allow: ['/3'] });
  });

  it('the last valid Crawl-delay across an agent’s groups wins', () => {
    const robots = parseRobotsTxt(
      'User-agent: a\nCrawl-delay: 1\n\nUser-agent: b\nDisallow: /\n\nUser-agent: a\nCrawl-delay: 2\nCrawl-delay: nope\n',
    );
    expect(getCrawlDelay(robots, 'a')).toBe(2);
  });

  it('an agent listed twice in one group gets each rule once', () => {
    const robots = parseRobotsTxt('User-agent: a\nUser-agent: A\nDisallow: /x\nAllow: /y\n');
    expect(robots.rules['a']).toEqual({ disallow: ['/x'], allow: ['/y'] });
  });

  it('a bare Disallow: creates the group, so the agent does not fall through to *', () => {
    const robots = parseRobotsTxt(
      'User-agent: CrawlmouseBot\nDisallow:\n\nUser-agent: *\nDisallow: /\n',
    );
    expect(robots.rules['crawlmousebot']).toEqual({ disallow: [], allow: [] });
    expect(isUrlAllowed(robots, 'https://x.test/page')).toBe(true);
  });

  it('a group whose only rule is an invalid Crawl-delay creates no group, so the agent falls through to *', () => {
    const robots = parseRobotsTxt(
      'User-agent: CrawlmouseBot\nCrawl-delay: soon\n\nUser-agent: *\nDisallow: /\n',
    );
    expect(Object.hasOwn(robots.rules, 'crawlmousebot')).toBe(false);
    expect(isUrlAllowed(robots, 'https://x.test/page')).toBe(false);
  });

  it('an empty Crawl-delay: reads as 0 and creates the group, so the agent does not fall through to *', () => {
    const robots = parseRobotsTxt(
      'User-agent: CrawlmouseBot\nCrawl-delay:\n\nUser-agent: *\nDisallow: /\n',
    );
    expect(robots.rules['crawlmousebot']).toEqual({ disallow: [], allow: [], crawlDelay: 0 });
    expect(isUrlAllowed(robots, 'https://x.test/page')).toBe(true);
  });

  it.each([
    ['0', 0],
    ['2.5', 2.5],
    ['0x10', 16],
    ['1e3', 1000],
  ])('reads Crawl-delay: %s as %d, as Number() does', (value, delay) => {
    expect(getCrawlDelay(parseRobotsTxt(`User-agent: *\nCrawl-delay: ${value}\n`), 'Bot')).toBe(
      delay,
    );
  });

  it.each(['Infinity', '1e999', '-1', '-0.5', 'abc', '5s'])(
    'ignores Crawl-delay: %s, which Number() does not read as a finite number >= 0',
    (value) => {
      const robots = parseRobotsTxt(`User-agent: *\nCrawl-delay: ${value}\n`);
      expect(getCrawlDelay(robots, 'Bot')).toBeUndefined();
      expect(Object.hasOwn(robots.rules, '*')).toBe(false);
    },
  );

  it('ignores an empty Sitemap:', () => {
    expect(parseRobotsTxt('Sitemap:\nSitemap: https://x.test/s.xml\n').sitemaps).toEqual([
      'https://x.test/s.xml',
    ]);
  });

  it('an invalid Crawl-delay still ends the agent list', () => {
    const robots = parseRobotsTxt('User-agent: a\nCrawl-delay: x\nUser-agent: b\nDisallow: /p\n');
    expect(Object.keys(robots.rules)).toEqual(['b']);
  });

  it('Sitemap and unknown directives do not end the agent list or the group', () => {
    const robots = parseRobotsTxt(
      'User-agent: a\nSitemap: https://x.test/s.xml\nUser-agent: b\nNoindex: /z\nUser-agent: c\nDisallow: /p\nNoindex: /q\nDisallow: /r\n',
    );
    expect(Object.keys(robots.rules)).toEqual(['a', 'b', 'c']);
    expect(robots.rules['b']).toEqual({ disallow: ['/p', '/r'], allow: [] });
    expect(robots.sitemaps).toEqual(['https://x.test/s.xml']);
  });

  it('an empty User-agent: after a rule sends the next rules to *', () => {
    const robots = parseRobotsTxt('User-agent: a\nDisallow: /1\nUser-agent:\nDisallow: /2\n');
    expect(robots.rules['a']).toEqual({ disallow: ['/1'], allow: [] });
    expect(robots.rules['*']).toEqual({ disallow: ['/2'], allow: [] });
  });

  it('an empty User-agent: inside an agent list is ignored', () => {
    const robots = parseRobotsTxt('User-agent: a\nUser-agent:\nDisallow: /1\n');
    expect(Object.keys(robots.rules)).toEqual(['a']);
  });

  it('reads directive names in any case, with space or tabs around the colon', () => {
    const robots = parseRobotsTxt('user-AGENT :  Bot\n  dIsAlLoW\t:\t/x  # note\n');
    expect(robots.rules['bot']).toEqual({ disallow: ['/x'], allow: [] });
  });

  it('splits at the first colon, so a value can hold one', () => {
    const robots = parseRobotsTxt('User-agent: *\nDisallow: /a:b\n');
    expect(robots.rules['*']!.disallow).toEqual(['/a:b']);
  });

  it('a # starts a comment, even inside a value', () => {
    const robots = parseRobotsTxt('User-agent: *\nDisallow: /a#b\n');
    expect(robots.rules['*']!.disallow).toEqual(['/a']);
  });

  it.each(['Dis allow: /x', 'Disallow_x: /x', '1Disallow: /x', 'Disallow /x', ': /x'])(
    'ignores a line that is not a directive: %j',
    (line) => {
      const robots = parseRobotsTxt(`User-agent: *\n${line}\nAllow: /y\n`);
      expect(robots.rules['*']).toEqual({ disallow: [], allow: ['/y'] });
    },
  );
});

describe('the parsed rules are read-only and inherit nothing', () => {
  const FILE =
    'User-agent: a\nUser-agent: b\nDisallow: /x\nCrawl-delay: 1\n\nUser-agent: a\nAllow: /y\n';

  it('agents of one group share one object', () => {
    const robots = parseRobotsTxt('User-agent: a\nUser-agent: b\nDisallow: /x\n');
    expect(robots.rules['a']).toBe(robots.rules['b']);
  });

  it('a write through one agent throws instead of changing another agent’s rules', () => {
    const robots = parseRobotsTxt(FILE);
    // b is in one group; a is in two, so its rules are a combination.
    expect(() => robots.rules['b']!.disallow.push('/z')).toThrow(TypeError);
    expect(() => {
      robots.rules['b']!.crawlDelay = 9;
    }).toThrow(TypeError);
    expect(() => robots.rules['a']!.allow.push('/z')).toThrow(TypeError);
    expect(() => {
      robots.rules['a']!.crawlDelay = 9;
    }).toThrow(TypeError);
    expect(() => {
      robots.rules['b'] = { disallow: [], allow: [] };
    }).toThrow(TypeError);
    expect(() => {
      robots.rules['a'] = { disallow: [], allow: [] };
    }).toThrow(TypeError);
    expect(() => {
      robots.rules['c'] = { disallow: [], allow: [] };
    }).toThrow(TypeError);
    expect(robots.rules['b']).toEqual({ disallow: ['/x'], allow: [], crawlDelay: 1 });
    expect(robots.rules['a']).toEqual({ disallow: ['/x'], allow: ['/y'], crawlDelay: 1 });
  });

  it('a group does not inherit crawlDelay when something else has set it on Object.prototype', () => {
    Object.defineProperty(Object.prototype, 'crawlDelay', {
      value: 99,
      configurable: true,
      writable: true,
    });
    try {
      const robots = parseRobotsTxt(`User-agent: *\nDisallow: /p\n\n${FILE}`);
      expect(getCrawlDelay(robots, 'SomeBot')).toBeUndefined(); // `*`, one group
      expect(getCrawlDelay(robots, 'a')).toBe(1); // a combination
      expect(Object.getPrototypeOf(robots.rules['*'])).toBeNull();
      expect(Object.getPrototypeOf(robots.rules['a'])).toBeNull();
    } finally {
      delete (Object.prototype as { crawlDelay?: unknown }).crawlDelay;
    }
  });

  it.each(INHERITED_NAMES)('%s in two groups is combined as an own key', (name) => {
    const robots = parseRobotsTxt(
      `User-agent: ${name}\nDisallow: /1\n\nUser-agent: other\nDisallow: /x\n\nUser-agent: ${name}\nCrawl-delay: 4\n`,
    );
    const key = name.toLowerCase();
    expect(ownGroup(robots, key)).toEqual({ disallow: ['/1'], allow: [], crawlDelay: 4 });
    expect(isAllowedByRobots(robots, name, '/1')).toBe(false);
    expect(getCrawlDelay(robots, name)).toBe(4);
    expectGlobalsUntouched();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Differential property. `referenceParse` is the parser as it was on main before this change, with
// only the deliberate changes applied: lines split on CR, LF or CRLF; `.` also matches U+2028 and
// U+2029 (the `s` flag), so a value or a comment can hold them; an agent is listed once per group.
// Its regexes are the quadratic ones, so it only sees short inputs. The property is not the only
// check: literal tests above pin quirks and deliberate changes one by one, because two parsers can
// agree and both be wrong.
// ─────────────────────────────────────────────────────────────────────────────

function referenceParse(text: string): ParsedRobots {
  const sitemaps: string[] = [];
  const rules: Record<string, Group> = Object.create(null);
  let currentUas: string[] = [];
  let lastWasRule = false;
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/s, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/s);
    if (!m) continue;
    const directive = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (directive === 'sitemap') {
      if (value) sitemaps.push(value);
    } else if (directive === 'user-agent') {
      if (lastWasRule) currentUas = [];
      const ua = value.toLowerCase();
      if (value && !currentUas.includes(ua)) currentUas.push(ua);
      lastWasRule = false;
    } else if (directive === 'disallow' || directive === 'allow') {
      for (const ua of currentUas.length ? currentUas : ['*']) {
        rules[ua] ??= { disallow: [], allow: [] };
        if (value) rules[ua][directive].push(value);
      }
      lastWasRule = true;
    } else if (directive === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) {
        for (const ua of currentUas.length ? currentUas : ['*']) {
          rules[ua] ??= { disallow: [], allow: [] };
          rules[ua].crawlDelay = n;
        }
      }
      lastWasRule = true;
    }
  }
  return { sitemaps, rules };
}

describe('differential: the parser against the reference', () => {
  const PROBES = [
    'CrawlmouseBot',
    '*',
    'GPTBot',
    'a',
    'b',
    '42',
    '__proto__',
    'two words',
    'nobody',
  ];
  const PROBE_PATHS = [
    '/',
    '/a',
    '/a/b',
    '/b',
    '/bx',
    '/c',
    '/x.pdf',
    '/a:b',
    '/p',
    '/x\u2028y',
    '/€',
  ];

  function expectSameAsReference(text: string): void {
    const got = parseRobotsTxt(text);
    const want = referenceParse(text);
    expect(got.sitemaps).toEqual(want.sitemaps);
    expect(Object.keys(got.rules)).toEqual(Object.keys(want.rules));
    for (const k of Object.keys(want.rules)) expect(got.rules[k]).toEqual(want.rules[k]);
    for (const ua of PROBES) {
      expect(getCrawlDelay(got, ua)).toBe(getCrawlDelay(want, ua));
      for (const p of PROBE_PATHS) {
        expect(isAllowedByRobots(got, ua, p)).toBe(isAllowedByRobots(want, ua, p));
      }
    }
  }

  it('the reference reproduces the literal cases it is meant to stand for', () => {
    const r = referenceParse('Disallow: /pre\nUser-agent: A\rUser-agent: a\r\nDisallow: /x\u2028y');
    expect(r.rules['*']).toEqual({ disallow: ['/pre'], allow: [] });
    expect(r.rules['a']).toEqual({ disallow: ['/x\u2028y'], allow: [] });
  });

  it('property: generated robots.txt files parse the same as the reference', () => {
    const SPACE = fc.constantFrom('', ' ', '\t', '  ', '\u2028', '\u2029', '\u00a0');
    const spell = (word: string) => fc.constantFrom(word, word.toUpperCase(), word.toLowerCase());
    const directive = (name: string, value: fc.Arbitrary<string>) =>
      fc
        .tuple(SPACE, spell(name), SPACE, SPACE, value, SPACE, fc.constantFrom('', '# c', ' #c:d'))
        .map(([s1, n, s2, s3, v, s4, c]) => `${s1}${n}${s2}:${s3}${v}${s4}${c}`);
    const AGENTS = fc.constantFrom(
      '',
      '*',
      'CrawlmouseBot',
      'crawlmousebot',
      'GPTBot',
      'a',
      'A',
      'b',
      '42',
      '__proto__',
      'Two Words',
    );
    const PATHS = fc.constantFrom(
      '',
      '/',
      '/a',
      '/a/b',
      '/b*',
      '/c$',
      '/*.pdf$',
      '/a:b',
      '/x\u2028y',
      '/p#frag',
      '/€',
    );
    const DELAYS = fc.constantFrom('', '0', '1', '2.5', ' 3 ', '-1', 'abc', '0x10', 'Infinity');
    const LINE = fc.oneof(
      directive('User-agent', AGENTS),
      directive('Disallow', PATHS),
      directive('Allow', PATHS),
      directive('Crawl-delay', DELAYS),
      directive('Sitemap', fc.constantFrom('', 'https://x.test/s.xml')),
      directive('Noindex', PATHS),
      fc.constantFrom(
        '',
        '   ',
        '# only a comment',
        'no colon here',
        'Dis allow: /x',
        '1abc: /y',
        ':',
        'User-agent',
        'Disallow_x: /z',
      ),
    );
    const EOL = fc.constantFrom('\n', '\r\n', '\r');
    const FILE = fc
      .tuple(fc.boolean(), fc.array(fc.tuple(LINE, EOL), { maxLength: 40 }))
      .map(([bom, lines]) => (bom ? '\uFEFF' : '') + lines.map(([l, e]) => l + e).join(''));

    fc.assert(fc.property(FILE, expectSameAsReference), { numRuns: 1000 });

    // Files built from whole groups, so that agents are named in several groups far more often than
    // in the line-by-line files above.
    const GROUP = fc
      .tuple(
        fc.array(directive('User-agent', AGENTS), { minLength: 1, maxLength: 3 }),
        fc.array(
          fc.oneof(
            directive('Disallow', PATHS),
            directive('Allow', PATHS),
            directive('Crawl-delay', DELAYS),
          ),
          { minLength: 1, maxLength: 3 },
        ),
      )
      .map(([agents, rules]) => [...agents, ...rules]);
    const GROUPED = fc
      .tuple(fc.array(GROUP, { maxLength: 30 }), EOL)
      .map(([groups, eol]) => groups.flat().join(eol));
    fc.assert(fc.property(GROUPED, expectSameAsReference), { numRuns: 500 });
  });

  it('property: text over the CC-12 alphabet parses the same as the reference', () => {
    const TOKEN = fc.constantFrom(...CC12_ALPHABET);
    fc.assert(
      fc.property(
        fc.array(TOKEN, { maxLength: 120 }).map((ts) => ts.join('')),
        expectSameAsReference,
      ),
      { numRuns: 1000 },
    );
  });
});

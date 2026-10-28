/**
 * Synthesises a recorded progress stream from a contract fixture.
 *
 * The fixtures hold a subset of each check's pages and links (their `withheld` entries say how
 * many), so a full stream cannot be copied out of them. This builds one deterministically from a
 * seed and agrees with the check on everything a screen shows of it: pages crawled and estimated,
 * template sizes, distinct links, orphan, JavaScript-only and deep page counts, the crawler
 * verdicts, the fixes as findings, the grades and the wall time. Pages the fixture holds keep their
 * URL, status, depth and link count; the rest get generated paths under their template. The tests
 * in synthesise.test.ts check each of those agreements.
 *
 * Fetch order follows the sitemap, as the engine seeds its queue from it, so a page can be fetched
 * before any link to it is found.
 */
import type { Check, FixtureDataset, PageResult } from '@crawlmouse/types/v2';
import { findCheck, fixesAsOf, siteOf, sinceStart, templateOf } from './fixtures';
import type { FixtureName } from './fixture-names';
import { ProgressEventSchema, type CheckPhase, type ProgressEvent } from './progress';
import { RecordingSchema, type Recording } from './recording';

/** A moment the stream must pass through exactly, and where that requirement comes from. */
export interface Moment {
  at_ms: number;
  pages_crawled: number;
  links_found: number;
  /** The last fetches before the moment, oldest first. */
  last_fetches: { url: string; status: number; links: number }[];
  source: string;
}

export interface RecordingSpec {
  fixture: FixtureName;
  check_id: string;
  /**
   * For a check still running: a finished check of the same site whose shape (templates, structure,
   * crawlers) the stream follows. The stream stops at the running check's moment.
   */
  shape_check_id?: string;
  moments: Moment[];
  seed: number;
}

type Role = 'home' | 'listing' | 'product' | 'article';

/** What kind of page a template holds, by its path prefix. An unknown prefix is an error. */
const ROLES: Record<string, Role> = {
  '/': 'home',
  '/collections/': 'listing',
  '/products/': 'product',
  '/blog/': 'article',
  '/journal/': 'article',
  '/guides/': 'article',
};

export function roleOf(templateKey: string): Role {
  const prefix = templateKey === '/' ? '/' : templateKey.replace(/\{[^}]+\}$/, '');
  const role = ROLES[prefix];
  if (!role) throw new Error(`No role for template ${templateKey}`);
  return role;
}

/** Links per page by role, when the fixture does not hold the page: [min, max]. Home: HOME_LINKS. */
const LINKS: Record<Role, [number, number]> = {
  home: [40, 48],
  listing: [18, 40],
  product: [8, 13],
  article: [12, 25],
};

/** The home page's links when the fixture does not hold it; also the depth-one budget. */
const HOME_LINKS = 48;

const ADJECTIVES = [
  'alpine',
  'arctic',
  'basin',
  'canyon',
  'cedar',
  'coastal',
  'desert',
  'forest',
  'glacier',
  'granite',
  'harbor',
  'highland',
  'lake',
  'meadow',
  'mesa',
  'north',
  'pine',
  'rapid',
  'ridge',
  'river',
  'sierra',
  'slate',
  'stone',
  'storm',
  'summit',
  'timber',
  'trail',
  'tundra',
  'valley',
  'wild',
];
const NOUNS = [
  'tent',
  'stove',
  'pack',
  'jacket',
  'shell',
  'mug',
  'lantern',
  'quilt',
  'pad',
  'bag',
  'boot',
  'pole',
  'tarp',
  'filter',
  'bottle',
  'hammock',
  'vest',
  'glove',
  'beanie',
  'fleece',
  'bivy',
  'cooler',
  'chair',
  'table',
  'knife',
  'headlamp',
  'compass',
  'gaiter',
  'poncho',
  'sack',
];
const ARTICLE_OPENINGS = [
  'choosing-a',
  'caring-for-a',
  'packing-a',
  'repairing-a',
  'a-season-with-a',
  'testing-a',
];

/** mulberry32: a small, seedable generator, so a spec always gives the same stream. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Page {
  url: string;
  template: string;
  role: Role;
  status: number;
  links: number;
  depth: number | null;
  parent: string | null;
  via: 'link' | 'javascript' | null;
  orphan: boolean;
  js: boolean;
  /** Held by the fixture, or named by a moment: its values are not generated. */
  given: boolean;
}

function fromPageResult(p: PageResult, keys: string[]): Page {
  const template = templateOf(keys, p.url);
  return {
    url: p.url,
    template,
    role: roleOf(template),
    status: p.status_code,
    links: p.links_out,
    depth: p.depth,
    parent: null,
    via: null,
    orphan: p.is_orphan,
    js: p.js_only,
    given: true,
  };
}

/** Largest-remainder rounding: integer parts of `total` in proportion to `weights`, summing to it. */
function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const exact = weights.map((w) => (w / sum) * total);
  const parts = exact.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    parts[i]!++;
    left--;
  }
  return parts;
}

export function synthesise(spec: RecordingSpec, d: FixtureDataset): Recording {
  const check = findCheck(d, spec.check_id);
  const shape = spec.shape_check_id ? findCheck(d, spec.shape_check_id) : check;
  if (!shape.coverage || !shape.structure) {
    throw new Error(`Check ${shape.id} has no coverage to shape a recording from`);
  }
  const { coverage, structure } = shape;
  const host = siteOf(d, check).host;
  const origin = `https://${host}`;
  const rand = prng(spec.seed);
  const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const keys = coverage.templates.map((t) => t.template_key);
  const running = check.status === 'running';

  // ── Pages ────────────────────────────────────────────────────────────────────────────────────
  const pages = new Map<string, Page>();
  for (const p of d.page_results.filter((r) => r.check_id === shape.id)) {
    pages.set(p.url, fromPageResult(p, keys));
  }
  for (const m of spec.moments) {
    for (const f of m.last_fetches) {
      if (pages.has(f.url)) continue;
      const template = templateOf(keys, f.url);
      pages.set(f.url, {
        url: f.url,
        template,
        role: roleOf(template),
        status: f.status,
        links: f.links,
        depth: null,
        parent: null,
        via: null,
        orphan: false,
        js: false,
        given: true,
      });
    }
  }
  const taken = new Set(pages.keys());
  function generatedUrl(template: string, role: Role): string {
    const prefix = template.replace(/\{[^}]+\}$/, '');
    for (;;) {
      const a = ADJECTIVES[between(0, ADJECTIVES.length - 1)]!;
      const n = NOUNS[between(0, NOUNS.length - 1)]!;
      const slug =
        role === 'listing'
          ? `${a}-${n}s`
          : role === 'article'
            ? `${ARTICLE_OPENINGS[between(0, ARTICLE_OPENINGS.length - 1)]}-${a}-${n}`
            : `${a}-${n}`;
      const url = `${origin}${prefix}${slug}`;
      if (!taken.has(url)) {
        taken.add(url);
        return url;
      }
    }
  }
  for (const t of coverage.templates) {
    const role = roleOf(t.template_key);
    const have = [...pages.values()].filter((p) => p.template === t.template_key).length;
    if (have > t.pages)
      throw new Error(`${t.template_key}: ${have} pages given, ${t.pages} crawled`);
    for (let i = have; i < t.pages; i++) {
      const [lo, hi] = LINKS[role];
      const url = role === 'home' ? `${origin}/` : generatedUrl(t.template_key, role);
      pages.set(url, {
        url,
        template: t.template_key,
        role,
        status: 200,
        links: role === 'home' ? HOME_LINKS : between(lo, hi),
        depth: null,
        parent: null,
        via: null,
        orphan: false,
        js: false,
        given: false,
      });
    }
  }
  const all = [...pages.values()];
  const home = all.find((p) => p.role === 'home');
  if (!home) throw new Error('No home page');
  home.depth = 0;
  const generated = (role?: Role) =>
    all.filter(
      (p) => !p.given && !p.orphan && !p.js && p.depth === null && (!role || p.role === role),
    );

  // ── Orphans and JavaScript-only pages ───────────────────────────────────────────────────────
  for (const role of ['product', 'article', 'listing'] as const) {
    for (const p of generated(role)) {
      if (all.filter((x) => x.orphan).length >= structure.orphan_pages) break;
      p.orphan = true;
    }
  }
  for (const role of ['listing', 'product', 'article'] as const) {
    for (const p of generated(role)) {
      if (all.filter((x) => x.js).length >= structure.js_only_pages) break;
      p.js = true;
    }
  }
  if (all.filter((p) => p.orphan).length !== structure.orphan_pages) throw new Error('orphans');
  if (all.filter((p) => p.js).length !== structure.js_only_pages) throw new Error('js-only pages');

  // ── The discovery tree ──────────────────────────────────────────────────────────────────────
  const attach = (child: Page, parent: Page, via: 'link' | 'javascript') => {
    if (child.parent !== null || child === parent || parent.depth === null) {
      throw new Error(`Cannot hang ${child.url} under ${parent.url}`);
    }
    child.parent = parent.url;
    child.via = via;
    child.depth = parent.depth! + 1;
  };
  const edges = d.link_edges.filter((e) => e.check_id === shape.id);
  for (let pass = 0; pass < 4; pass++) {
    for (const e of edges) {
      const from = pages.get(e.from_url);
      const to = pages.get(e.to_url);
      if (!from || !to || to.parent || to === home || from.depth === null) continue;
      if (to.depth !== null && to.depth !== from.depth + 1) continue;
      if (to.js !== e.js_only) continue;
      attach(to, from, e.js_only ? 'javascript' : 'link');
    }
  }
  const regular = () => all.filter((p) => !p.orphan && !p.js && p !== home);
  const atDepth = (depth: number, role?: Role) =>
    regular().filter((p) => p.depth === depth && p.parent !== null && (!role || p.role === role));
  const pick = <T>(list: T[], i: number) => list[i % list.length]!;
  /** Pages still without a place in the tree, the fixture's own included. */
  const unplaced = (role?: Role) =>
    regular().filter((p) => p.parent === null && (!role || p.role === role));

  // Given pages with a depth but no parent hang under a page one level up, made if need be.
  const chainTo = (depth: number, role: Role): Page => {
    const existing = atDepth(depth - 1, role)[0] ?? atDepth(depth - 1)[0];
    if (existing) return existing;
    // The parent first, so the bridge chosen next cannot be the page the parent was made from.
    const parent = depth - 1 === 1 ? home : chainTo(depth - 1, role);
    const bridge = generated(role)[0] ?? generated()[0];
    if (!bridge) throw new Error(`No page left to reach depth ${depth}`);
    attach(bridge, parent, 'link');
    return bridge;
  };
  for (const p of regular().filter((x) => x.given && x.parent === null && x.depth !== null)) {
    attach(p, p.depth === 1 ? home : chainTo(p.depth!, p.role), 'link');
  }
  // Pages deeper than three clicks.
  while (regular().filter((p) => (p.depth ?? 0) > 3).length < structure.pages_deeper_than_3) {
    const parent = chainTo(4, 'product');
    const p = generated('product')[0] ?? generated()[0];
    if (!p) throw new Error('No page left to place deeper than three clicks');
    attach(p, parent, 'link');
  }
  // The rest: depth one up to the home page's links, listings and articles first, then depth two.
  const homeBudget = home.links;
  for (const role of ['listing', 'article', 'product'] as const) {
    for (const p of unplaced(role)) {
      if (atDepth(1).length >= homeBudget) break;
      attach(p, home, 'link');
    }
  }
  const hubs = atDepth(1, 'listing').length ? atDepth(1, 'listing') : atDepth(1);
  unplaced().forEach((p, i) => attach(p, pick(hubs, i), 'link'));
  if (regular().some((p) => p.parent === null)) throw new Error('A page has no parent');

  // ── The sample tested as each crawler ───────────────────────────────────────────────────────
  const sampledGiven = d.page_results
    .filter((r) => r.check_id === shape.id && r.sampled)
    .map((r) => pages.get(r.url)!);
  const eligible = all.filter((p) => !p.js);
  let sample: Page[];
  if (coverage.sample_strategy.method === 'census') {
    sample = eligible;
  } else {
    const quotas = apportion(
      coverage.pages_sampled,
      coverage.templates.map((t) => t.pages),
    ).map((q, i) => Math.max(q, coverage.templates[i]!.pages > 0 ? 1 : 0));
    while (quotas.reduce((a, b) => a + b, 0) > coverage.pages_sampled) {
      quotas[quotas.indexOf(Math.max(...quotas))]!--;
    }
    sample = coverage.templates.flatMap((t, i) => {
      const given = sampledGiven.filter((p) => p.template === t.template_key);
      const rest = eligible.filter(
        (p) => p.template === t.template_key && !given.includes(p) && !p.orphan,
      );
      return [...given, ...rest].slice(0, quotas[i]);
    });
  }
  if (sample.length !== coverage.pages_sampled) {
    throw new Error(`Sampled ${sample.length}, the check says ${coverage.pages_sampled}`);
  }
  // A JavaScript-only page is found by rendering a sampled page that links to it.
  const jsParents = sample.filter((p) => p.depth === 1 && !p.orphan);
  all
    .filter((p) => p.js && p.parent === null)
    .forEach((p, i) => attach(p, pick(jsParents, i), 'javascript'));
  for (const p of all.filter((x) => x.js)) {
    if (!sample.some((s) => s.url === p.parent)) throw new Error(`${p.url}: parent not sampled`);
  }

  // ── Timeline ─────────────────────────────────────────────────────────────────────────────────
  const robotsTest = d.access_tests.find(
    (t) => t.check_id === check.id && t.evidence_class === 'declared',
  );
  const T_robots = robotsTest ? sinceStart(check, robotsTest.tested_at) : 3000;
  const T_homeFetch = T_robots + 700;
  const T_home = T_robots + 1600;
  const crawlCount = all.filter((p) => !p.js).length;
  const lastMoment = spec.moments.at(-1);
  const T_tests = check.tested_at
    ? sinceStart(check, check.tested_at)
    : lastMoment
      ? Math.ceil(lastMoment.at_ms * (crawlCount / lastMoment.pages_crawled))
      : null;
  if (T_tests === null) throw new Error('No moment the crawler tests start at');
  const T_end = check.finished_at ? sinceStart(check, check.finished_at) : null;
  const until = running ? lastMoment?.at_ms : T_end;
  if (until === undefined || until === null) throw new Error('No moment the recording covers to');
  const span = (T_end ?? T_tests * 1.6) - T_tests;
  const T_js = Math.round(T_tests + span * 0.7);
  const T_grade = Math.round((T_end ?? T_tests + span) - Math.max(1500, span * 0.08));
  const T_final = T_end ?? T_tests + span;

  const events: (ProgressEvent & { seq: number })[] = [];
  let seq = 0;
  const emit = (e: ProgressEvent) => events.push({ ...e, seq: seq++ });
  const stage = (at_ms: number, phase: CheckPhase, state: 'now' | 'done') =>
    emit({ type: 'stage', at_ms, phase, state });

  stage(0, 'robots_and_sitemap', 'now');
  emit({
    type: 'pages_estimated',
    at_ms: T_robots,
    pages: running ? estimateOf(check) : coverage.pages_discovered,
  });
  // A running check has no results yet; its search-engine verdicts are not borrowed from another.
  for (const r of running ? [] : shape.crawlers.filter((c) => c.evidence_class === 'declared')) {
    emit({
      type: 'crawler_verdict',
      at_ms: T_robots,
      ua: r.ua,
      group: r.group,
      scored: r.scored,
      verdict: r.verdict,
      evidence_class: r.evidence_class,
      status: r.status,
      pages_measured: r.pages_measured,
    });
  }
  stage(T_robots, 'robots_and_sitemap', 'done');
  stage(T_robots, 'homepage', 'now');

  // The crawl order: the home page, then the sitemap's order, with each moment's named fetches
  // placed last before it.
  const order = all.filter((p) => !p.js && p !== home);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const crawl = [home, ...order];
  for (const m of spec.moments) {
    const named = m.last_fetches.map((f) => pages.get(f.url)!);
    const rest = crawl.filter((p) => !named.includes(p));
    rest.splice(m.pages_crawled - named.length, 0, ...named);
    crawl.splice(0, crawl.length, ...rest);
  }

  // When each crawl fetch lands: evenly between anchors, jittered inside its own slot.
  const anchors: { at: number; count: number; links: number }[] = [
    { at: T_home, count: 1, links: home.links },
    ...spec.moments.map((m) => ({ at: m.at_ms, count: m.pages_crawled, links: m.links_found })),
  ];
  const jsNew = all.filter((p) => p.js).map(() => 2);
  const crawlLinks = running ? null : structure.internal_links - jsNew.reduce((a, b) => a + b, 0);
  anchors.push({
    at: T_tests - 400,
    count: crawl.length,
    links: crawlLinks ?? Math.round(anchors.at(-1)!.links * (crawl.length / anchors.at(-1)!.count)),
  });
  const fetchAt: number[] = [T_homeFetch];
  const newLinks: number[] = [home.links];
  for (let a = 1; a < anchors.length; a++) {
    const prev = anchors[a - 1]!;
    const next = anchors[a]!;
    const n = next.count - prev.count;
    if (n < 0 || next.links < prev.links) throw new Error('Anchors out of order');
    const slot = (next.at - prev.at) / Math.max(n, 1);
    for (let k = 1; k <= n; k++) {
      fetchAt.push(Math.round(prev.at + k * slot - rand() * slot * 0.4));
    }
    const slice = crawl.slice(prev.count, next.count);
    newLinks.push(
      ...apportion(
        next.links - prev.links,
        slice.map((p) => Math.max(p.links, 1)),
      ),
    );
  }

  // ── Events ───────────────────────────────────────────────────────────────────────────────────
  let crawled = 0;
  let found = 0;
  const linked = new Set<string>();
  const childrenOf = (p: Page, via: 'link' | 'javascript') =>
    all.filter((c) => c.parent === p.url && c.via === via);
  crawl.forEach((p, i) => {
    const at = fetchAt[i]!;
    crawled++;
    found += newLinks[i]!;
    emit({
      type: 'page_fetched',
      at_ms: at,
      url: p.url,
      identity: crawlIdentity(shape),
      purpose: 'crawl',
      status: p.status,
      ms: between(70, 420),
      links: p.links,
    });
    emit({ type: 'counts', at_ms: at, pages_crawled: crawled, links_found: found });
    for (const c of childrenOf(p, 'link')) {
      if (linked.has(c.url)) continue;
      linked.add(c.url);
      emit({ type: 'page_linked', at_ms: at, url: c.url, from: p.url, via: 'link' });
    }
    if (i === 0) {
      stage(T_home, 'homepage', 'done');
      stage(T_home, 'crawl', 'now');
    }
  });

  const fixes = fixesAsOf(d, shape);
  all
    .filter((p) => p.orphan)
    .forEach((p, i) =>
      emit({ type: 'page_classified', at_ms: T_tests - 300 + i * 30, url: p.url, as: 'orphan' }),
    );
  const finding = (at_ms: number, f: (typeof fixes)[number]) =>
    emit({
      type: 'finding',
      at_ms,
      fingerprint: f.fingerprint,
      title: f.title,
      section: f.section,
      affected_pages: f.affected_pages,
    });
  fixes
    .filter((f) => f.section === 'structure')
    .forEach((f, i) => finding(T_tests - 80 + i * 10, f));
  stage(T_tests, 'crawl', 'done');
  stage(T_tests, 'crawler_tests', 'now');

  // Crawler tests: each AI crawler requests the sample, then the untagged control request.
  const tested = shape.crawlers.filter((c) => c.evidence_class !== 'declared');
  const blocks = [...tested.map((c) => c.ua), null];
  const testsEnd = T_js - 400;
  const per = (testsEnd - (T_tests + 300)) / (blocks.length * sample.length);
  const controlBlocked = tested.some((c) => c.verdict === 'edge_blocks_automation');
  const landed = new Map<string, number>();
  blocks.forEach((ua, b) => {
    const r = ua ? tested.find((c) => c.ua === ua)! : null;
    sample.forEach((p, k) => {
      const known = d.access_tests.find(
        (t) => t.check_id === check.id && t.ua === ua && t.page_url === p.url,
      );
      const at = known
        ? sinceStart(check, known.tested_at)
        : Math.round(T_tests + 300 + (b * sample.length + k) * per);
      const byTemplate = r?.by_template.find((t) => t.template_key === p.template);
      const status =
        known?.raw_status ??
        (r ? (byTemplate?.status ?? r.status ?? 200) : controlBlocked ? 403 : 200);
      const thin = (byTemplate?.verdict ?? r?.verdict) === 'allowed_thin';
      emit({
        type: 'page_fetched',
        at_ms: at,
        url: p.url,
        identity: ua ?? 'browser',
        purpose: ua ? 'test' : 'control',
        status,
        ms: status >= 400 ? between(30, 110) : between(60, 300),
        links: status === 200 ? (thin ? Math.round(p.links * (r?.text_share ?? 1)) : p.links) : 0,
      });
      if (ua) landed.set(ua, Math.max(landed.get(ua) ?? 0, at));
    });
    if (r) {
      emit({
        type: 'crawler_verdict',
        at_ms: landed.get(r.ua)! + 150,
        ua: r.ua,
        group: r.group,
        scored: r.scored,
        verdict: r.verdict,
        evidence_class: r.evidence_class,
        status: r.status,
        pages_measured: r.pages_measured,
      });
    }
  });
  fixes
    .filter((f) => f.section === 'crawler_access')
    .forEach((f) => {
      const at = Math.max(...f.crawler_uas.map((ua) => landed.get(ua) ?? T_tests), T_tests);
      finding(at + 270, f);
    });
  stage(T_js, 'crawler_tests', 'done');
  stage(T_js, 'without_js', 'now');

  // Renders of the sample; a JavaScript-only page is found, fetched and classified as its
  // parent's render reveals the link.
  const renderEnd = T_grade - 600;
  const step = (renderEnd - (T_js + 200)) / sample.length;
  const firstRender = new Map<string, number>();
  const discoveries: { at: number; page: Page; parent: Page }[] = [];
  sample.forEach((p, k) => {
    const at = Math.round(T_js + 200 + k * step);
    emit({
      type: 'page_fetched',
      at_ms: at,
      url: p.url,
      identity: 'render',
      purpose: 'render',
      status: 200,
      ms: between(900, 2400),
      links: p.links,
    });
    if (!firstRender.has(p.template)) firstRender.set(p.template, at);
    childrenOf(p, 'javascript').forEach((c, j) =>
      discoveries.push({ at: at + 60 + j * 300, page: c, parent: p }),
    );
  });
  // Counted in the order they are found, which is not always the order of their parents' renders.
  discoveries
    .sort((a, b) => a.at - b.at)
    .forEach(({ at, page: c, parent }, i) => {
      crawled++;
      found += jsNew[i]!;
      emit({ type: 'page_linked', at_ms: at, url: c.url, from: parent.url, via: 'javascript' });
      emit({
        type: 'page_fetched',
        at_ms: at + 120,
        url: c.url,
        identity: crawlIdentity(shape),
        purpose: 'crawl',
        status: c.status,
        ms: between(70, 420),
        links: c.links,
      });
      emit({ type: 'counts', at_ms: at + 120, pages_crawled: crawled, links_found: found });
      emit({ type: 'page_classified', at_ms: at + 240, url: c.url, as: 'js_only' });
    });
  fixes
    .filter((f) => f.section === 'without_js')
    .forEach((f) =>
      finding(
        f.template_key && firstRender.get(f.template_key)
          ? firstRender.get(f.template_key)! + 150
          : T_grade - 500,
        f,
      ),
    );
  fixes
    .filter((f) => f.section === 'content')
    .forEach((f, i) => finding(T_grade - 400 + i * 80, f));
  stage(T_grade, 'without_js', 'done');
  stage(T_grade, 'grading', 'now');
  if (!running) {
    stage(T_final, 'grading', 'done');
    if (!shape.technical_seo || !shape.ai_readability)
      throw new Error('A finished check carries both grades');
    emit({
      type: 'graded',
      at_ms: T_final,
      technical_seo: shape.technical_seo,
      ai_readability: shape.ai_readability,
    });
    emit({
      type: 'ended',
      at_ms: T_final,
      status: check.status === 'partial' ? 'partial' : 'finished',
    });
  }

  const ordered = events
    .filter((e) => e.at_ms <= until)
    .sort((a, b) => a.at_ms - b.at_ms || a.seq - b.seq)
    .map((e) => ProgressEventSchema.parse(withoutSeq(e)));
  return RecordingSchema.parse({
    provenance: 'synthesised',
    fixture: spec.fixture,
    check_id: check.id,
    host,
    started_at: check.started_at,
    until_ms: until,
    events: ordered,
  });
}

function withoutSeq(e: ProgressEvent & { seq: number }): ProgressEvent {
  const copy: Partial<typeof e> = { ...e };
  delete copy.seq;
  return copy as ProgressEvent;
}

/** Who the crawl requests as: an untagged browser, or a full render when the edge refuses that. */
function crawlIdentity(check: Check): string {
  return check.crawlers.some((c) => c.verdict === 'edge_blocks_automation') ? 'render' : 'browser';
}

function estimateOf(check: Check): number {
  const estimate = check.progress?.pages_estimated;
  if (estimate === null || estimate === undefined)
    throw new Error(`Check ${check.id} has no estimate`);
  return estimate;
}

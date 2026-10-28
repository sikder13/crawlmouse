export interface RobotsRules {
  disallow: string[];
  allow: string[];
  /** Non-standard `Crawl-delay` (seconds) for this UA group, when declared. Honored as a §5 floor. */
  crawlDelay?: number;
}

export interface ParsedRobots {
  sitemaps: string[];
  /**
   * Key = lower-cased UA, `'*'` for the wildcard. Read it by key or with `Object.keys`.
   *
   * From `parseRobotsTxt`:
   * - This object, each group in it and each group's arrays are frozen, and the objects have no
   *   prototype. So a write throws, `toStrictEqual` against an object literal fails, and
   *   `Object.assign` into a plain object makes a `__proto__` group the target's prototype.
   * - Agents named in one group share one group object.
   * - An agent named in several groups is a getter. Its first read combines those groups in file
   *   order, and agents named in the same groups share the result. Reading every key of a file built
   *   to give each agent its own combination builds every combination; `groupFor` below reads one
   *   agent and `*`.
   */
  rules: Record<string, RobotsRules>;
}

/**
 * RFC 9309 §2.5: a parser must read at least 500 KiB. Text past this, counted as UTF-8 after any
 * leading BOM, is not read, and the line the limit cuts is dropped whole, so a cut rule cannot widen.
 */
export const ROBOTS_PARSE_LIMIT_BYTES = 500 * 1024;

export function parseRobotsTxt(text: string): ParsedRobots {
  const sitemaps: string[] = [];
  // One object per RFC 9309 group, and each agent's groups as indexes into `groups`, in file order.
  // Storing a group once, however many agents name it, keeps the result linear in the file.
  const groups: RobotsRules[] = [];
  const groupsOf = new Map<string, number[]>();
  // The agents the next rules apply to, and their group once a rule has created it.
  let agents = new Set<string>();
  let group: RobotsRules | undefined;
  let lastWasRule = false;

  const openGroup = (): RobotsRules => {
    const g = newGroup();
    const index = groups.push(g) - 1;
    // Directives before any user-agent line are attributed to '*' rather than discarded.
    for (const ua of agents.size ? agents : ['*']) {
      const list = groupsOf.get(ua);
      if (list) list.push(index);
      else groupsOf.set(ua, [index]);
    }
    return g;
  };

  // Strip a leading BOM (otherwise the first "User-agent:" line is unrecognized and the whole group is
  // silently dropped). Lines end at CR, LF or CRLF (RFC 9309 §2.2), and are read with indexOf rather
  // than a regex: the regexes this replaced backtracked quadratically on a lone CR, U+2028 or U+2029.
  for (const rawLine of withinParseLimit(text.replace(/^\uFEFF/, '')).split(/\r\n|\r|\n/)) {
    const hash = rawLine.indexOf('#');
    const line = (hash === -1 ? rawLine : rawLine.slice(0, hash)).trim();
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    // Only the five names below are acted on, so a name with other characters is skipped by falling
    // through every branch.
    const directive = line.slice(0, colon).trimEnd().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (directive === 'sitemap') {
      if (value) sitemaps.push(value);
    } else if (directive === 'user-agent') {
      // Consecutive user-agent lines (with no rule in between) share one group, per
      // RFC 9309. A user-agent line after a rule starts a new group.
      if (lastWasRule) {
        agents = new Set();
        group = undefined;
      }
      if (value) agents.add(value.toLowerCase());
      lastWasRule = false;
    } else if (directive === 'disallow' || directive === 'allow') {
      // Empty values (e.g. bare "Disallow:") impose no restriction, but still create the group.
      group ??= openGroup();
      if (value) group[directive].push(value);
      lastWasRule = true;
    } else if (directive === 'crawl-delay') {
      // Non-standard but widely honored. A malformed/negative value is ignored and creates no group.
      // Either way it counts as a rule for grouping.
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) (group ??= openGroup()).crawlDelay = n;
      lastWasRule = true;
    }
  }

  for (const g of groups) freezeGroup(g);
  // User-agent values come from the audited site. With no prototype, `__proto__` or `constructor` is
  // an ordinary key here, not a path to Object.prototype or Object.
  const rules: Record<string, RobotsRules> = Object.create(null);
  // Combinations already built, keyed by the group indexes they combine.
  const combinations = new Map<string, RobotsRules>();
  for (const [ua, indexes] of groupsOf) {
    if (indexes.length === 1) {
      Object.defineProperty(rules, ua, { value: groups[indexes[0]!], enumerable: true });
      continue;
    }
    // Built on first read, not here: combining every agent up front is N agents x M rules again
    // when each agent is in a big shared group plus a group of its own.
    let combined: RobotsRules | undefined;
    Object.defineProperty(rules, ua, {
      enumerable: true,
      get: () => {
        if (!combined) {
          const key = indexes.join(',');
          combined = combinations.get(key) ?? combine(indexes.map((i) => groups[i]!));
          combinations.set(key, combined);
        }
        return combined;
      },
    });
  }
  return { sitemaps, rules: Object.freeze(rules) };
}

/** A group with no prototype, so an undeclared `crawlDelay` is never inherited from Object.prototype. */
function newGroup(): RobotsRules {
  const g: RobotsRules = Object.create(null);
  g.disallow = [];
  g.allow = [];
  return g;
}

/** Groups are shared between agents, so they are frozen: a write through one agent throws. */
function freezeGroup(g: RobotsRules): RobotsRules {
  Object.freeze(g.disallow);
  Object.freeze(g.allow);
  return Object.freeze(g);
}

/** One agent's groups, combined in file order. The last declared Crawl-delay wins. */
function combine(list: readonly RobotsRules[]): RobotsRules {
  const out = newGroup();
  for (const g of list) {
    for (const r of g.disallow) out.disallow.push(r);
    for (const r of g.allow) out.allow.push(r);
    if (g.crawlDelay !== undefined) out.crawlDelay = g.crawlDelay;
  }
  return freezeGroup(out);
}

/** The part of `text` the parser reads: see ROBOTS_PARSE_LIMIT_BYTES. */
function withinParseLimit(text: string): string {
  // A UTF-16 code unit is at most 3 bytes of UTF-8, so text this short is within the limit.
  if (text.length * 3 <= ROBOTS_PARSE_LIMIT_BYTES) return text;
  // encodeInto stops before a character that does not fit; `read` counts the UTF-16 units it took.
  const { read } = new TextEncoder().encodeInto(text, new Uint8Array(ROBOTS_PARSE_LIMIT_BYTES));
  if (read === text.length) return text;
  const kept = text.slice(0, read);
  const next = text.charCodeAt(read);
  if (next === 0x0a || next === 0x0d) return kept; // the limit falls at a line end
  return kept.slice(0, Math.max(kept.lastIndexOf('\n'), kept.lastIndexOf('\r')) + 1);
}

/**
 * Matches a robots rule against a path, honoring the two wildcards the Robots
 * Exclusion Protocol (RFC 9309) requires: `*` (any sequence) and a trailing `$`
 * (anchor to end). Implemented as a linear segment walk rather than a translated
 * regex: `*` -> `.*` produces catastrophic backtracking, and robots.txt is served
 * by the (untrusted) audited site and matched per enqueued link, so a regex
 * translation is a denial-of-service vector. This is O(segments x pathLength).
 */
function ruleMatches(rule: string, path: string): boolean {
  const anchored = rule.endsWith('$');
  const body = anchored ? rule.slice(0, -1) : rule;
  const segments = body.split('*'); // literal segments between wildcards

  let pos = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (seg === '') continue; // leading/trailing/consecutive '*' contribute no literal
    const isFirst = i === 0;
    const isLast = i === segments.length - 1;
    if (isFirst) {
      // The rule is implicitly anchored at the start.
      if (!path.startsWith(seg)) return false;
      pos = seg.length;
    } else if (isLast && anchored) {
      // Under '$' the final literal must sit flush at the end, after the prefix.
      if (path.length - seg.length < pos || !path.endsWith(seg)) return false;
      pos = path.length;
    } else {
      const idx = path.indexOf(seg, pos);
      if (idx === -1) return false;
      pos = idx + seg.length;
    }
  }

  if (anchored) {
    // '$' requires reaching the end. A rule ending in '*' (empty last segment)
    // absorbs the remainder; otherwise the final literal must have hit the end.
    return segments[segments.length - 1] === '' || pos === path.length;
  }
  return true;
}

/** Match specificity = the rule length excluding wildcard tokens (Google's rule). */
function matchSpecificity(rule: string, path: string): number | null {
  if (!ruleMatches(rule, path)) return null;
  return rule.replace(/\*/g, '').replace(/\$$/, '').length;
}

/**
 * The group that binds `userAgent`: its own group, else `*`. Reads own keys only, because callers can
 * pass a ParsedRobots the parser did not build (scripts/research/cf-panel passes an object literal; one
 * that went through JSON comes back plain), and on a plain object with no `constructor` group,
 * `rules['constructor']` is Object.
 */
function groupFor(robots: ParsedRobots, userAgent: string): RobotsRules | undefined {
  const own = (key: string) => (Object.hasOwn(robots.rules, key) ? robots.rules[key] : undefined);
  return own(userAgent.toLowerCase()) ?? own('*');
}

/**
 * The `Crawl-delay` (seconds) that applies to this UA, using the same most-specific-group-wins
 * resolution as `isAllowedByRobots` (a matched UA group with no crawl-delay does NOT fall through
 * to `*`). Returns undefined when none is declared. Honored by the polite crawler as a hard floor.
 */
export function getCrawlDelay(robots: ParsedRobots, userAgent: string): number | undefined {
  return groupFor(robots, userAgent)?.crawlDelay;
}

/**
 * Our product token, matched against robots.txt user-agent groups. Lives here rather than in the
 * crawler because §4.1 requires ONE gate for every entry path — a second copy of this string in
 * another module is how the rule quietly becomes two rules with different behaviour.
 */
export const ROBOTS_UA = 'CrawlmouseBot';

/**
 * §4.1 — THE single robots gate. Every URL entering the frontier passes through this, whatever its
 * discovery source: an enqueued link, a sitemap seed, a redirect target, a rel=canonical target.
 *
 * Takes a whole URL rather than a path because every caller holds a URL. Making each call site extract
 * `pathname + search` itself is precisely how the sitemap path came to have no check at all.
 *
 * Two deliberate "allow" defaults, both matching the incumbent enqueue behaviour exactly so this
 * change adds no new blocking anywhere: no robots.txt means nothing is disallowed, and an unparseable
 * URL is not treated as disallowed (it will fail later, in the fetch, on its own terms).
 */
export function isUrlAllowed(robots: ParsedRobots | null | undefined, url: string): boolean {
  if (!robots) return true;
  try {
    const { pathname, search } = new URL(url);
    return isAllowedByRobots(robots, ROBOTS_UA, pathname + search);
  } catch {
    return true;
  }
}

export function isAllowedByRobots(robots: ParsedRobots, userAgent: string, path: string): boolean {
  const r = groupFor(robots, userAgent);
  if (!r) return true;

  // Most specific match wins (longest rule). Allow beats Disallow on a tie (RFC 9309).
  let best: { isAllow: boolean; len: number } | null = null;
  for (const rule of r.disallow) {
    const len = matchSpecificity(rule, path);
    if (len !== null && (!best || len > best.len)) best = { isAllow: false, len };
  }
  for (const rule of r.allow) {
    const len = matchSpecificity(rule, path);
    if (len !== null && (!best || len >= best.len)) best = { isAllow: true, len };
  }

  return best ? best.isAllow : true;
}

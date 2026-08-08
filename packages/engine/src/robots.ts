export interface RobotsRules {
  disallow: string[];
  allow: string[];
  /** Non-standard `Crawl-delay` (seconds) for this UA group, when declared. Honored as a §5 floor. */
  crawlDelay?: number;
}

export interface ParsedRobots {
  sitemaps: string[];
  rules: Record<string, RobotsRules>;       // key = lowercased UA, '*' for wildcard
}

export function parseRobotsTxt(text: string): ParsedRobots {
  const sitemaps: string[] = [];
  const rules: Record<string, RobotsRules> = {};
  let currentUas: string[] = [];
  let lastWasRule = false;

  // Strip a leading BOM (otherwise the first "User-agent:" line is unrecognized
  // and the whole group is silently dropped).
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const directive = m[1]!.toLowerCase();
    const value = m[2]!.trim();

    if (directive === 'sitemap') {
      if (value) sitemaps.push(value);
    } else if (directive === 'user-agent') {
      // Consecutive user-agent lines (with no rule in between) share one group, per
      // RFC 9309. A user-agent line after a rule starts a new group.
      if (lastWasRule) currentUas = [];
      if (value) currentUas.push(value.toLowerCase());
      lastWasRule = false;
    } else if (directive === 'disallow' || directive === 'allow') {
      // Directives before any user-agent line are attributed to '*' rather than
      // discarded. Empty values (e.g. bare "Disallow:") impose no restriction.
      const uas = currentUas.length ? currentUas : ['*'];
      for (const ua of uas) {
        rules[ua] ??= { disallow: [], allow: [] };
        if (value) rules[ua][directive].push(value);
      }
      lastWasRule = true;
    } else if (directive === 'crawl-delay') {
      // Non-standard but widely honored. Attach the (non-negative numeric) delay to the current
      // UA group(s); a malformed/negative value is ignored. Counts as a rule for grouping.
      const uas = currentUas.length ? currentUas : ['*'];
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) {
        for (const ua of uas) {
          rules[ua] ??= { disallow: [], allow: [] };
          rules[ua].crawlDelay = n;
        }
      }
      lastWasRule = true;
    }
  }

  return { sitemaps, rules };
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
 * The `Crawl-delay` (seconds) that applies to this UA, using the same most-specific-group-wins
 * resolution as `isAllowedByRobots` (a matched UA group with no crawl-delay does NOT fall through
 * to `*`). Returns undefined when none is declared. Honored by the polite crawler as a hard floor.
 */
export function getCrawlDelay(robots: ParsedRobots, userAgent: string): number | undefined {
  const r = robots.rules[userAgent.toLowerCase()] ?? robots.rules['*'];
  return r?.crawlDelay;
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
  const r = robots.rules[userAgent.toLowerCase()] ?? robots.rules['*'];
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

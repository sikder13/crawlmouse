export interface RobotsRules {
  disallow: string[];
  allow: string[];
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
    }
  }

  return { sitemaps, rules };
}

/**
 * Compiles a robots rule into an anchored RegExp honoring the two wildcards the
 * Robots Exclusion Protocol (RFC 9309) requires crawlers to support: `*` (any
 * sequence of characters) and a trailing `$` (end of path).
 */
function compileRule(rule: string): RegExp {
  const hasEnd = rule.endsWith('$');
  const body = hasEnd ? rule.slice(0, -1) : rule;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + escaped + (hasEnd ? '$' : ''));
}

/** Match specificity = the rule length excluding wildcard tokens (Google's rule). */
function matchSpecificity(rule: string, path: string): number | null {
  try {
    if (!compileRule(rule).test(path)) return null;
  } catch {
    return null;
  }
  return rule.replace(/\*/g, '').replace(/\$$/, '').length;
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

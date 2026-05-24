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

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (!m) continue;
    const directive = m[1]!.toLowerCase();
    const value = m[2]!.trim();

    if (directive === 'sitemap') {
      if (value) sitemaps.push(value);
    } else if (directive === 'user-agent') {
      currentUas = [value.toLowerCase()];
    } else if (directive === 'disallow' || directive === 'allow') {
      for (const ua of currentUas) {
        rules[ua] ??= { disallow: [], allow: [] };
        if (value) rules[ua][directive].push(value);
      }
    }
  }

  return { sitemaps, rules };
}

export function isAllowedByRobots(robots: ParsedRobots, userAgent: string, path: string): boolean {
  const uaKey = userAgent.toLowerCase();
  const r = robots.rules[uaKey] ?? robots.rules['*'];
  if (!r) return true;

  // Most specific match wins (longest prefix). Allow > Disallow at equal length.
  let bestMatch: { isAllow: boolean; len: number } | null = null;
  for (const rule of r.disallow) if (path.startsWith(rule)) {
    if (!bestMatch || rule.length > bestMatch.len) bestMatch = { isAllow: false, len: rule.length };
  }
  for (const rule of r.allow) if (path.startsWith(rule)) {
    if (!bestMatch || rule.length >= bestMatch.len) bestMatch = { isAllow: true, len: rule.length };
  }

  return bestMatch ? bestMatch.isAllow : true;
}

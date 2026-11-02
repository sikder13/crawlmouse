/**
 * hreflang_gap: a cluster of alternate-language pages whose annotations are incomplete.
 *
 * A cluster is the set of URLs joined by the hreflang annotations of the crawled 200 pages whose
 * hreflang was read, keyed by its lowest URL. A member that was read is checked for a self-reference
 * (in a language, not as the `x-default`), an `x-default`, valid codes, and a return annotation from
 * each alternate it names. A member that was crawled and redirects or is gone cannot annotate back,
 * so links to it lack their return. A member that was not crawled, was not read at its own URL, or
 * answered a status that kept its content from us (`isUnread`) is unknown, and its annotations are
 * not counted as missing. A cluster with no defect is clear only when `absenceUnproven` (scope.ts)
 * finds nothing the crawl missed: an unfetched page could annotate into it.
 */
import { LANGUAGE_CODES, REGION_CODES } from './hreflang-codes.js';
import { absenceUnproven, byText, isUnread, record, scopeOf, type Scope } from './scope.js';
import type { Condition, Detection, DetectorInput, HreflangLink } from './types.js';

export { LANGUAGE_CODES, REGION_CODES };

const isXDefault = (lang: string) => lang.toLowerCase() === 'x-default';

/**
 * `x-default`, or a language code with an optional four-letter script and an optional region,
 * case-insensitive: `en`, `en-GB`, `zh-Hant`, `zh-Hant-TW`. The script is checked for form only.
 */
export function isValidHreflang(value: string): boolean {
  if (isXDefault(value)) return true;
  const m = /^([a-z]{2})(?:-[a-z]{4})?(?:-([a-z]{2}))?$/i.exec(value);
  if (m === null) return false;
  return (
    LANGUAGE_CODES.has(m[1]!.toLowerCase()) &&
    (m[2] === undefined || REGION_CODES.has(m[2].toUpperCase()))
  );
}

/** The groups of URLs the read annotations join, each sorted, in order of their first URL. */
function clustersOf(read: ReadonlyMap<string, readonly HreflangLink[]>): string[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(x, root);
    return root;
  };
  const union = (a: string, b: string) => {
    for (const x of [a, b]) if (!parent.has(x)) parent.set(x, x);
    const [ra, rb] = [find(a), find(b)].sort(byText);
    parent.set(rb!, ra!);
  };
  for (const [url, links] of read) for (const l of links) union(url, l.href);
  const groups = new Map<string, string[]>();
  // Appended in place: a copy per URL made a cluster of n URLs cost n² (a site's pages can each name
  // up to MAX_HREFLANG_LINKS alternates, so n reaches 256 × pages).
  for (const x of parent.keys()) {
    const root = find(x);
    const group = groups.get(root);
    if (group) group.push(x);
    else groups.set(root, [x]);
  }
  return [...groups.values()].map((g) => g.sort(byText)).sort((a, b) => byText(a[0]!, b[0]!));
}

function judge(
  members: string[],
  read: ReadonlyMap<string, readonly HreflangLink[]>,
  s: Scope,
): Detection {
  const defects = new Map<string, Set<Condition>>();
  const flag = (url: string, c: Condition) =>
    defects.set(url, (defects.get(url) ?? new Set()).add(c));
  // A crawled member that redirects or is gone serves no annotations of its own to link back with.
  const cannotAnswer = (url: string) => {
    const p = s.page.get(url);
    if (p === undefined) return false;
    if (p.status_code !== 200) return !isUnread(p.status_code);
    const landed = s.facts.get(url)?.final_url ?? null;
    return landed !== null && landed !== url;
  };
  let unknown = false;
  for (const m of members) {
    const links = read.get(m);
    if (links === undefined) {
      if (!cannotAnswer(m)) unknown = true;
      continue;
    }
    if (!links.some((l) => l.href === m && !isXDefault(l.lang))) flag(m, 'hreflang_missing_self');
    if (!links.some((l) => isXDefault(l.lang))) flag(m, 'hreflang_missing_x_default');
    if (links.some((l) => !isValidHreflang(l.lang))) flag(m, 'hreflang_invalid_code');
    for (const target of new Set(links.map((l) => l.href))) {
      if (target === m) continue;
      const back = read.get(target);
      if (back ? !back.some((l) => l.href === m) : cannotAnswer(target))
        flag(m, 'hreflang_missing_return');
    }
  }
  const key = members[0]!;
  const pages = members.filter((m) => s.page.has(m));
  if (defects.size > 0) {
    return record('hreflang_gap', key, {
      state: 'detected',
      measured: defects.size,
      conditions: [...defects.values()].flatMap((c) => [...c]),
      affected: defects.keys(),
      pages,
    });
  }
  const base = { measured: 0, pages };
  if (unknown)
    return record('hreflang_gap', key, {
      ...base,
      state: 'indeterminate',
      reason: 'member_not_crawled',
    });
  const unproven = absenceUnproven(s);
  if (unproven !== null) {
    return record('hreflang_gap', key, { ...base, state: 'indeterminate', reason: unproven });
  }
  return record('hreflang_gap', key, { ...base, state: 'not_detected' });
}

export function detectHreflangGaps(input: DetectorInput): Detection[] {
  const s = scopeOf(input);
  const read = new Map<string, readonly HreflangLink[]>();
  for (const url of s.ok) {
    const facts = s.facts.get(url);
    // Annotations read from where the request ended belong to that URL, not to this one.
    if (facts?.hreflang && facts.final_url === url) read.set(url, facts.hreflang);
  }
  return clustersOf(read).map((members) => judge(members, read, s));
}

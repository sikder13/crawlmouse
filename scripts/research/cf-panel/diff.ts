import type { BotAccessResult, DomainSnapshot, PanelGroup } from './types.js';

export const GROUPS: readonly PanelGroup[] = ['cf_ads', 'cf_no_ads', 'ads_no_cf'];

/** A count is never published without the denominator it was taken over. */
export interface Measure {
  count: number;
  of: number;
  pct: number | null;
}

export interface TokenDelta {
  /** Was reachable at `from`, root-disallowed at `to`. */
  toBlocked: number;
  /** Root-disallowed at `from`, reachable at `to`. */
  toUnblocked: number;
  /** Any change of access state, including allowed ↔ partially_disallowed. */
  statusChanged: number;
  of: number;
}

export interface GroupReport {
  domains: number;
  comparable: number;
  bothReadable: number;
  robotsHashChanged: Measure;
  robotsAvailabilityChanged: Measure;
  gainedContentSignals: Measure;
  lostContentSignals: Measure;
  groupSignalsChanged: Measure;
  anyAiTokenNewlyBlocked: Measure;
  aiTokens: Record<string, TokenDelta>;
  searchTokens: Record<string, TokenDelta>;
}

export interface DiffReport {
  from: string;
  to: string;
  generatedAt: string;
  /** Aggregate counts only. Per-domain listings live in the snapshots, which are the raw data. */
  perDomainListings: false;
  totals: GroupReport;
  groups: Record<PanelGroup, GroupReport>;
  examples: string[];
}

function measure(count: number, of: number): Measure {
  return { count, of, pct: of === 0 ? null : Number(((count / of) * 100).toFixed(2)) };
}

const readable = (s: DomainSnapshot): boolean => s.robots.status === 200 && s.robots.sha256 !== null;
const blocked = (a: BotAccessResult | undefined): boolean | null =>
  a === undefined ? null : a.status === 'disallowed_root';

function byToken(snap: DomainSnapshot): Map<string, BotAccessResult> {
  return new Map(snap.access.map((a) => [a.token, a]));
}

function emptyDelta(): TokenDelta {
  return { toBlocked: 0, toUnblocked: 0, statusChanged: 0, of: 0 };
}

/** Pure: takes two runs already loaded from disk and returns the aggregate. No IO, no network. */
export function aggregatePair(
  pairs: readonly { from: DomainSnapshot; to: DomainSnapshot }[],
  domainsInGroup: number,
  aiTokens: readonly string[],
  searchTokens: readonly string[],
): GroupReport {
  const both = pairs.filter((p) => readable(p.from) && readable(p.to));

  let hashChanged = 0;
  for (const p of both) if (p.from.robots.sha256 !== p.to.robots.sha256) hashChanged += 1;

  let availabilityChanged = 0;
  for (const p of pairs) if (readable(p.from) !== readable(p.to)) availabilityChanged += 1;

  let gained = 0;
  let lost = 0;
  for (const p of both) {
    const a = p.from.contentSignals.length;
    const b = p.to.contentSignals.length;
    if (a === 0 && b > 0) gained += 1;
    if (a > 0 && b === 0) lost += 1;
  }

  let groupSignalsChanged = 0;
  for (const p of pairs) {
    const cfFrom = p.from.homepage.cfRay || (p.from.homepage.server ?? '').toLowerCase() === 'cloudflare';
    const cfTo = p.to.homepage.cfRay || (p.to.homepage.server ?? '').toLowerCase() === 'cloudflare';
    const adsFrom = p.from.adsTxt.status === 200;
    const adsTo = p.to.adsTxt.status === 200;
    if (cfFrom !== cfTo || adsFrom !== adsTo) groupSignalsChanged += 1;
  }

  const tally = (tokens: readonly string[]): Record<string, TokenDelta> => {
    const out: Record<string, TokenDelta> = {};
    for (const t of tokens) out[t] = emptyDelta();
    for (const p of both) {
      const f = byToken(p.from);
      const t2 = byToken(p.to);
      for (const token of tokens) {
        const a = f.get(token);
        const b = t2.get(token);
        if (a === undefined || b === undefined) continue;
        const d = out[token]!;
        d.of += 1;
        if (a.status !== b.status) d.statusChanged += 1;
        const wasBlocked = blocked(a);
        const isBlocked = blocked(b);
        if (wasBlocked === false && isBlocked === true) d.toBlocked += 1;
        if (wasBlocked === true && isBlocked === false) d.toUnblocked += 1;
      }
    }
    return out;
  };

  const aiDeltas = tally(aiTokens);
  let anyNewlyBlocked = 0;
  for (const p of both) {
    const f = byToken(p.from);
    const t2 = byToken(p.to);
    const hit = aiTokens.some((token) => {
      const a = f.get(token);
      const b = t2.get(token);
      return a !== undefined && b !== undefined && blocked(a) === false && blocked(b) === true;
    });
    if (hit) anyNewlyBlocked += 1;
  }

  return {
    domains: domainsInGroup,
    comparable: pairs.length,
    bothReadable: both.length,
    robotsHashChanged: measure(hashChanged, both.length),
    robotsAvailabilityChanged: measure(availabilityChanged, pairs.length),
    gainedContentSignals: measure(gained, both.length),
    lostContentSignals: measure(lost, both.length),
    groupSignalsChanged: measure(groupSignalsChanged, pairs.length),
    anyAiTokenNewlyBlocked: measure(anyNewlyBlocked, both.length),
    aiTokens: aiDeltas,
    searchTokens: tally(searchTokens),
  };
}

export function buildReport(args: {
  from: string;
  to: string;
  fromSnaps: readonly DomainSnapshot[];
  toSnaps: readonly DomainSnapshot[];
  aiTokens: readonly string[];
  searchTokens: readonly string[];
  exampleLimit?: number;
}): DiffReport {
  const { from, to, fromSnaps, toSnaps, aiTokens, searchTokens } = args;
  const exampleLimit = args.exampleLimit ?? 0;

  const toByDomain = new Map(toSnaps.map((s) => [s.domain, s]));
  const pairs = fromSnaps
    .map((f) => ({ from: f, to: toByDomain.get(f.domain) }))
    .filter((p): p is { from: DomainSnapshot; to: DomainSnapshot } => p.to !== undefined);

  const groups = {} as Record<PanelGroup, GroupReport>;
  for (const g of GROUPS) {
    const inGroup = pairs.filter((p) => p.from.group === g);
    const domainsInGroup = fromSnaps.filter((s) => s.group === g).length;
    groups[g] = aggregatePair(inGroup, domainsInGroup, aiTokens, searchTokens);
  }

  // `examples` exists so the shape of the report is stable, and is EMPTY by default. The published
  // numbers are aggregates; anyone who wants to see which domains moved has the raw snapshots.
  const examples: string[] = [];
  if (exampleLimit > 0) {
    for (const p of pairs) {
      if (examples.length >= exampleLimit) break;
      if (readable(p.from) && readable(p.to) && p.from.robots.sha256 !== p.to.robots.sha256) {
        examples.push(p.from.domain);
      }
    }
  }

  return {
    from,
    to,
    generatedAt: new Date().toISOString(),
    perDomainListings: false,
    totals: aggregatePair(pairs, fromSnaps.length, aiTokens, searchTokens),
    groups,
    examples,
  };
}

const pct = (m: Measure): string => (m.pct === null ? '   n/a' : `${m.pct.toFixed(2).padStart(6)}%`);

export function renderTable(r: DiffReport): string {
  const lines: string[] = [];
  lines.push(`Cloudflare policy panel — ${r.from} → ${r.to}`);
  lines.push('');

  const rows: [string, (g: GroupReport) => string][] = [
    ['domains in panel', (g) => String(g.domains).padStart(7)],
    ['compared (both runs)', (g) => String(g.comparable).padStart(7)],
    ['robots readable in both', (g) => String(g.bothReadable).padStart(7)],
    ['robots.txt hash changed', (g) => `${String(g.robotsHashChanged.count).padStart(4)} ${pct(g.robotsHashChanged)}`],
    ['robots availability changed', (g) => `${String(g.robotsAvailabilityChanged.count).padStart(4)} ${pct(g.robotsAvailabilityChanged)}`],
    ['gained Content Signals', (g) => `${String(g.gainedContentSignals.count).padStart(4)} ${pct(g.gainedContentSignals)}`],
    ['lost Content Signals', (g) => `${String(g.lostContentSignals.count).padStart(4)} ${pct(g.lostContentSignals)}`],
    ['any AI token newly blocked', (g) => `${String(g.anyAiTokenNewlyBlocked.count).padStart(4)} ${pct(g.anyAiTokenNewlyBlocked)}`],
    ['cf/ads signals changed', (g) => `${String(g.groupSignalsChanged.count).padStart(4)} ${pct(g.groupSignalsChanged)}`],
  ];

  const cols: [string, GroupReport][] = [
    ['cf_ads', r.groups.cf_ads],
    ['cf_no_ads', r.groups.cf_no_ads],
    ['ads_no_cf', r.groups.ads_no_cf],
    ['ALL', r.totals],
  ];

  lines.push(`${''.padEnd(30)}${cols.map(([n]) => n.padStart(14)).join('')}`);
  lines.push('─'.repeat(30 + cols.length * 14));
  for (const [label, cell] of rows) {
    lines.push(`${label.padEnd(30)}${cols.map(([, g]) => cell(g).padStart(14)).join('')}`);
  }

  lines.push('');
  lines.push('Per-token movement (count newly blocked / count unblocked, over robots readable in both runs)');
  lines.push('─'.repeat(30 + cols.length * 14));
  const tokenNames = Object.keys(r.totals.aiTokens).concat(Object.keys(r.totals.searchTokens));
  for (const token of tokenNames) {
    const cell = (g: GroupReport): string => {
      const d = g.aiTokens[token] ?? g.searchTokens[token];
      return d ? `${d.toBlocked} / ${d.toUnblocked}` : '-';
    };
    lines.push(`${token.padEnd(30)}${cols.map(([, g]) => cell(g).padStart(14)).join('')}`);
  }

  lines.push('');
  lines.push('Percentages are over the denominator named in the row above them, not the panel size.');
  lines.push('This report carries aggregates only; the per-domain record is the snapshot files.');
  return lines.join('\n');
}

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * GUARD — no unreviewed char-index cut on crawled text, and no engine barrel in the client bundle.
 *
 * Crawled text is attacker-controlled and reaches Postgres jsonb/text through PostgREST, whose body
 * Postgres parses as JSON. Postgres rejects an unpaired UTF-16 surrogate (22P02), so a `.slice()` that
 * lands between the halves of a pair fails the insert, throws in `persistAuditResults`, and fails THE
 * WHOLE AUDIT. Four such sites shipped at once, and the reason was never that any one was hard to
 * spot — it was that nobody could enumerate them.
 *
 * WHY THIS IS LINE-BASED. The first version of this guard matched the RECEIVER before `.slice`, which
 * a leading-dot chain on its own line — the prettier style used throughout this repo — walked straight
 * past. Six real cuts were invisible, including one the same round had just added, while the test
 * named "every char-index cut is classified" reported green. Matching the METHOD TOKEN on its own line
 * cannot be dodged by formatting; the cost is that reformatting a listed line fails the test, which is
 * a human review, not a bug.
 *
 * When this fails, do NOT paste the new line in. Decide first:
 *   - does the receiver hold crawled text (page text, title, anchor, URL, JSON-LD, llms.txt, robots)?
 *   - does the result get persisted, minted, exported, or sent to a subprocessor?
 * If yes to both, route it through `toPersistableText` instead of adding it here.
 */

const REPO = resolve(__dirname, '../../..');
/** Every directory that can reach a database write, a public artifact, an export, or the DOM. */
const ROOTS = [
  'packages/engine/src',
  'packages/types/src',
  'apps/web/lib',
  'apps/web/app',
  'apps/web/components',
  'inngest',
];
/** Top-level files, which a directory-only ROOTS list silently skipped. */
const ROOT_FILES = ['apps/web/middleware.ts', 'apps/web/instrumentation.ts', 'apps/web/instrumentation-client.ts'];
/**
 * Matches the OPERATION of cutting, not three identifier names. The previous version enumerated
 * `slice|substring|substr` followed by `(`, and five idioms walked past it — two of them VERIFIED to
 * split surrogate pairs on crawled text:
 *
 *   v.replace(/^([\s\S]{0,100})[\s\S]*$/, '$1')     regex truncation   — splits pairs
 *   v.match(/[\s\S]{0,100}/)![0]                     match truncation   — splits pairs
 *   v.slice?.(0, 100)                                 optional call
 *   String.prototype.slice.call(v, 0, 100)            no `(` after the token
 *   Buffer.from(v,'utf16le').subarray(0,n)            byte cut, different method name
 *
 * Enumerating names is how a guard becomes decorative. These three patterns cover the operation:
 * a length-bounded method call, a length-bounded regex quantifier, and a byte-level view.
 */
const CUT_METHOD = /\.\s*(slice|substring|substr|subarray)\s*(\?\.)?\s*[(.]/;
/** A `{0,N}` / `{N}` quantifier inside replace/match/exec is truncation spelled as a pattern. */
const CUT_REGEX = /\.\s*(replace|match|exec)\s*\(.*\{\s*\d*\s*,?\s*\d+\s*\}/;
const CUT_BYTES = /Buffer\.from\s*\([^)]*\)\s*\.\s*(subarray|slice|toString)/;
/** `v['slice'](0,n)` — computed member access sidesteps a dot-token match. */
const CUT_COMPUTED = /\[\s*['"](slice|substring|substr|subarray)['"]\s*\]\s*\(/;
/** A `{0,N}`/`{N}` quantifier in a module-level regex CONST, used for truncation elsewhere. */
const CUT_HOISTED_RE = /^\s*(const|let|var)\s+\w*(TRUNC|CUT|CAP|LIMIT|MAX)\w*\s*=\s*\/.*\{\s*\d*\s*,?\s*\d+\s*\}/i;
// NOT detected, deliberately: a manual `for (i<cap) out += v.charAt(i)` accumulation loop. Every
// line-based pattern for it also matches legitimate single-character reads (`charAt(0)` for an
// initial, `charCodeAt(i)` inside text-safety itself), so the rule would be suppressed within a week.
// Logged as FU-8 with the verified evasion rather than shipped as noise.
const isCut = (line: string): boolean =>
  CUT_METHOD.test(line) || CUT_REGEX.test(line) || CUT_BYTES.test(line) ||
  CUT_COMPUTED.test(line) || CUT_HOISTED_RE.test(line);

/** [ "<path> :: <source line>", "why it is safe" ] — the auditable inventory. */
const INVENTORY: [entry: string, why: string][] = [
  ["apps/web/app/api/admin/takedown/process/route.ts :: const token = header.startsWith('Bearer ') ? header.slice(7) : '';",
   "ASCII/structural \u2014 hex, percent-encoding, punctuation, a date prefix or a file extension"],
  ["apps/web/app/api/audits/[id]/export/route.ts :: .slice()",
   "array slice \u2014 cannot split a surrogate pair"],
  ["apps/web/app/api/reports/[slug]/logo/route.ts :: const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);",
   "ASCII/structural \u2014 hex, percent-encoding, punctuation, a date prefix or a file extension"],
  ["apps/web/app/blog/[slug]/page.tsx :: const related = postsNewestFirst().filter((p) => p.slug !== meta.slug).slice(0, 2);",
   "array slice \u2014 cannot split a surrogate pair"],
  ["apps/web/app/embed/[domain]/route.ts :: return htmlResponse(noReportBadge(String(rawDomain).slice(0, 253)), 400);",
   "display-only, never persisted"],
  ["apps/web/components/audit/ActivityFeed.tsx :: const visible = events.slice(-DISPLAY_CAP);",
   "array slice \u2014 cannot split a surrogate pair"],
  ["apps/web/components/report/AiReadinessReportSection.tsx :: const shown = ordered.slice(0, REPORT_AI_MAX_FINDINGS);",
   "array slice \u2014 cannot split a surrogate pair"],
  ["apps/web/components/report/ReportLegacyFallback.tsx :: Automated, deterministic analysis of publicly served HTML, as of {r.created_at.slice(0, 10)}.",
   "ASCII/structural \u2014 hex, percent-encoding, punctuation, a date prefix or a file extension"],
  ["apps/web/components/report/sections.tsx :: const asOf = snapshot.mintedAt.slice(0, 10); // deterministic YYYY-MM-DD (no locale/tz variance)",
   "ASCII/structural \u2014 hex, percent-encoding, punctuation, a date prefix or a file extension"],
  ["apps/web/components/ui/LocalTime.tsx :: {local ?? iso.slice(0, 10)}",
   "ASCII/structural \u2014 hex, percent-encoding, punctuation, a date prefix or a file extension"],
  ["apps/web/lib/ai-readiness-packets.ts :: .slice(0, WHAT_AI_SEES_MAX_PAGES)",
   "array slice \u2014 cannot split a surrogate pair"],
  ["apps/web/lib/ai-readiness-packets.ts :: data.push(dataLine('Structured data', sig.jsonLd.present ? (sig.jsonLd.valid ? `present: ${sig.jsonLd.types.slice(0, 10).join(', ') || 'untyped'}` : 'present but malformed') : 'none'));",
   "array slice \u2014 cannot split a surrogate pair"],
  ["apps/web/lib/audit-activity.ts :: const feed = [...s.feed, ...fresh].slice(-MAX_FEED_LENGTH);",
   "array slice \u2014 cannot split a surrogate pair"],
  ["apps/web/lib/audit-activity.ts :: label: String(e.label).slice(0, MAX_ACTIVITY_LABEL_LENGTH),",
   "crawled text, cut WITHOUT the shared helper \u2014 PRE-EXISTING, tracked as FU-7"],
  ["apps/web/lib/audit-crawl-health-telemetry.ts :: const safeUrl = url.slice(0, MAX_URL);",
   "crawled text, cut WITHOUT the shared helper \u2014 PRE-EXISTING, tracked as FU-7"],
  ["apps/web/lib/audit-failure-sentry.ts :: extra: { auditId, reason: reason.slice(0, 500) },",
   "crawled text, cut WITHOUT the shared helper \u2014 PRE-EXISTING, tracked as FU-7"],
  ["apps/web/lib/audit-stream-projection.ts :: .slice(0, AI_CLIENT_MAX_FINDINGS),",
   "array slice \u2014 cannot split a surrogate pair"],
  ["apps/web/lib/billing/csv.ts :: return raw.length > max ? `${raw.slice(0, max)}\u2026` : raw;",
   "crawled text, cut WITHOUT the shared helper \u2014 PRE-EXISTING, tracked as FU-7"],
  ["apps/web/lib/findings.ts :: const shown = isPro || uncapped ? rows : rows.slice(0, freeLimit);",
   "array slice \u2014 cannot split a surrogate pair"],
  ["apps/web/lib/graph-assembly.ts :: const outEdges: GraphEdge[] = amongSelected.slice(0, edgeCap).map((e) => ({ from: e.fromUrl, to: e.toUrl, nofollow: false }));",
   "array slice \u2014 cannot split a surrogate pair"],
  ["apps/web/lib/graph-assembly.ts :: if (home) selected = [...selected.slice(0, Math.max(0, nodeCap - 1)), home];",
   "array slice \u2014 cannot split a surrogate pair"],
  ["apps/web/lib/graph-assembly.ts :: let selected = ranked.slice(0, nodeCap);",
   "array slice \u2014 cannot split a surrogate pair"],
  ["apps/web/lib/report-content.ts :: const list = top.length === 1 ? top[0] : `${top.slice(0, -1).join(', ')} and ${top[top.length - 1]}`;",
   "array slice \u2014 cannot split a surrogate pair"],
  ["apps/web/lib/report-content.ts :: const top = issues.slice(0, 3).map((i) => i.phrase);",
   "array slice \u2014 cannot split a surrogate pair"],
  ["apps/web/lib/report-snapshot.ts :: const findings: ReportSnapshotAiFinding[] = ordered.slice(0, MAX_AI_FINDINGS).map((f) => ({",
   "array slice \u2014 cannot split a surrogate pair"],
  ["apps/web/lib/share-url.ts :: const clean = raw.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);",
   "ASCII/structural \u2014 hex, percent-encoding, punctuation, a date prefix or a file extension"],
  ["apps/web/lib/share-url.ts :: const params = typeof search === 'string' ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search) : search;",
   "ASCII/structural \u2014 hex, percent-encoding, punctuation, a date prefix or a file extension"],
  ["apps/web/lib/url-display.ts :: const rest = raw.slice(i);",
   "display-only, never persisted"],
  ["inngest/persist-helpers.ts :: .slice(0, Math.max(0, AI_PERSIST_MAX_FINDINGS - reservedIdx.size));",
   "array slice \u2014 cannot split a surrogate pair"],
  // SPEC 5.1a §12 — the fingerprint strata cap (boundFingerprintForPersist). An ARRAY slice over
  // {templateKey, discovered, selected} records, so it cuts between whole objects and cannot land
  // inside a string, let alone between the halves of a surrogate pair. `templateKey` is derived from
  // crawled URLs and is carried WHOLE.
  ["inngest/persist-helpers.ts :: .slice(0, FINGERPRINT_PERSIST_MAX_STRATA);",
   "array slice \u2014 cannot split a surrogate pair"],
  // SPEC 5.1a §8 — the discovery cap (capDiscovered). An ARRAY slice over FrontierRecord objects, so
  // it cuts between whole records and cannot land inside a string. `url` and `template_key` hold
  // crawled text and are carried WHOLE.
  ["packages/engine/src/analysis/frontier-checkpoint.ts :: .slice(0, max);",
   "array slice \u2014 cannot split a surrogate pair"],
  ["inngest/persist-helpers.ts :: const kept = all.filter((_, i) => keep.has(i)).slice(0, AI_PERSIST_MAX_FINDINGS);",
   "array slice — the final clamp on the findings array; cannot split a surrogate pair"],
  ["inngest/progress.ts :: decodeURIComponent(raw.slice(0, cut));",
   "crawled text, cut WITHOUT the shared helper \u2014 PRE-EXISTING, tracked as FU-7"],
  ["inngest/progress.ts :: if (ring.length > ringSize) ring = ring.slice(ring.length - ringSize);",
   "array slice \u2014 cannot split a surrogate pair"],
  ["inngest/progress.ts :: return raw.slice(0, cut) + '\u2026';",
   "crawled text, cut WITHOUT the shared helper \u2014 PRE-EXISTING, tracked as FU-7"],
  ["apps/web/components/ai/ai-view-logic.ts :: return `${chars.slice(0, head).join('').trimEnd()}\\u2026${chars.slice(chars.length - tail).join('').trimStart()}`;",
   "ARRAY slices over Array.from() code points (middle-ellipsis, keeps the distinguishing tail) \u2014 cannot split a surrogate pair; RENDER-only, never persisted"],
  ["apps/web/components/ai/ai-view-logic.ts :: return chars.length > max ? `${chars.slice(0, max).join('').trimEnd()}\\u2026` : text;",
   "ARRAY slice over Array.from() code points \u2014 cannot split a surrogate pair; RENDER-only, never persisted"],
  ["packages/engine/src/analysis/ai-readiness/classify.ts :: if (NOSCRIPT_JS_NOTICE.test($(el).text().slice(0, NOTICE_SCAN_CAP))) notice = true;",
   "scan buffer only \u2014 matched by a regex, never persisted"],
  ["packages/engine/src/text-safety.ts :: piece = s.slice(i, i + 2); // a valid pair, kept whole",
   "the shared helper itself — takes a surrogate pair WHOLE, by construction"],
  ["packages/engine/src/analysis/ai-readiness/finding-id.ts :: return createHash('sha256').update(`${kind}|${target ?? ''}`).digest('hex').slice(0, 16);",
   "ASCII/structural \u2014 hex, percent-encoding, punctuation, a date prefix or a file extension"],
  ["packages/engine/src/analysis/ai-readiness/llms-txt.ts :: const scan = body.length > LLMS_TXT_SCAN_CAP ? body.slice(0, LLMS_TXT_SCAN_CAP) : body;",
   "scan buffer only \u2014 matched by a regex, never persisted"],
  ["packages/engine/src/analysis/classify-pages.ts :: return make('duplicate', `duplicate_of:${rep.urlHash.slice(0, 12)}`, simhash, rep.urlHash);",
   "ASCII/structural \u2014 a sha256 hex identity hash, not crawled text; no surrogate can exist in it"],
  ["packages/engine/src/analysis/simhash.ts :: const h = featureHash(tokens.slice(i, i + SHINGLE_SIZE).join(' '));",
   "array slice \u2014 cannot split a surrogate pair"],
  ["packages/engine/src/crawler.ts :: const token = part.includes(':') ? part.slice(part.indexOf(':') + 1) : part;",
   "ASCII/structural \u2014 splits an X-Robots-Tag directive at its colon; the result is compared, never persisted"],
  ["packages/engine/src/analysis/structure.ts :: .slice(0, topCount)",
   "array slice \u2014 cannot split a surrogate pair"],
  ["packages/engine/src/analysis/structure.ts :: const topSum = sorted.slice(0, topCount).reduce((s, v) => s + v, 0);",
   "array slice \u2014 cannot split a surrogate pair"],
  // SPEC 5.1a §7.2 added `declaredUrls` to this return so orphan triangulation can difference the
  // DECLARED set against link-reachability. The CUT is unchanged — still `.slice(0, pageCap)` over an
  // array of URLs — so the classification stands; only the line’s text moved, which is the human
  // review this guard exists to force, not a defect it caught.
  ["packages/engine/src/audit.ts :: return { seeds: [homepageUrl, ...ordered].slice(0, pageCap), sitemapUrlCount, declaredUrls: declared, robotsExcluded };",
   "array slice \u2014 cannot split a surrogate pair"],
  ["packages/engine/src/crawler.ts :: return (pathname + search).slice(0, 200) || '/';",
   "ASCII/structural \u2014 hex, percent-encoding, punctuation, a date prefix or a file extension"],
  ["packages/engine/src/crawler.ts :: return u.slice(0, 200);",
   "crawled text, cut WITHOUT the shared helper \u2014 PRE-EXISTING, tracked as FU-7"],
  ["packages/engine/src/extract.ts :: return MEDIA_EXTENSIONS.has(last.slice(dot + 1).toLowerCase());",
   "ASCII/structural \u2014 hex, percent-encoding, punctuation, a date prefix or a file extension"],
  ["packages/engine/src/projection/action-packet.ts :: .slice(0, cap);",
   "crawled text, cut WITHOUT the shared helper \u2014 PRE-EXISTING, tracked as FU-7"],
  ["packages/engine/src/projection/action-packet.ts :: return u.replace(/[\\u0000-\\u001f\\u007f\\s`]+/g, '').slice(0, cap);",
   "crawled text, cut WITHOUT the shared helper \u2014 PRE-EXISTING, tracked as FU-7"],
  ["packages/engine/src/projection/ledger.ts :: .slice(0, opts.linksPerFix);",
   "array slice \u2014 cannot split a surrogate pair"],
  ["packages/engine/src/projection/ledger.ts :: if (words.length >= 3) candidates.push(words.slice(0, 3).join(' '));",
   "array slice \u2014 cannot split a surrogate pair"],
  ["packages/engine/src/projection/ledger.ts :: return s.replace(/[\\s\\x00-\\x1f]+/g, ' ').trim().slice(0, cap);",
   "crawled text, cut WITHOUT the shared helper \u2014 PRE-EXISTING, tracked as FU-7"],
  ["packages/engine/src/projection/projection.ts :: .slice(0, maxFixes);",
   "array slice \u2014 cannot split a surrogate pair"],
  ["packages/engine/src/projection/relevance.ts :: return shared.slice(0, k);",
   "array slice \u2014 cannot split a surrogate pair"],
  ["packages/engine/src/robots.ts :: const body = anchored ? rule.slice(0, -1) : rule;",
   "ASCII/structural \u2014 hex, percent-encoding, punctuation, a date prefix or a file extension"],
  ["packages/engine/src/ssrf-guard.ts :: const ipv4CompatHex = lower.match(/^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);",
   "ASCII/structural — IPv6 hex parse, not a truncation"],
  ["packages/engine/src/ssrf-guard.ts :: const ipv4MappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);",
   "ASCII/structural — IPv6 hex parse, not a truncation"],
  ["packages/engine/src/ssrf-guard.ts :: const nat64 = lower.match(/^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);",
   "ASCII/structural — IPv6 hex parse, not a truncation"],
  ["packages/engine/src/ssrf-guard.ts :: const sixToFour = lower.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(?::|$)/);",
   "ASCII/structural — IPv6 hex parse, not a truncation"],
  ["packages/engine/src/ssrf-guard.ts :: const firstByte = parseInt(lower.slice(0, 2), 16);",
   "ASCII/structural \u2014 hex, percent-encoding, punctuation, a date prefix or a file extension"],
  ["packages/engine/src/ssrf-guard.ts :: const secondByte = parseInt(lower.slice(2, 4), 16);",
   "ASCII/structural \u2014 hex, percent-encoding, punctuation, a date prefix or a file extension"],
  ["inngest/persist-results.ts :: const { error: pagesErr } = await sb.from('pages').insert(pageRows.slice(i, i + PAGE_INSERT_CHUNK));",
   "array slice — the insert chunking window; cannot split a surrogate pair"],
  ["packages/engine/src/analysis/ai-readiness/excerpt.ts :: return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();",
   "cut at a space index, which can never fall inside a surrogate pair"],
  ["packages/engine/src/crawler.ts :: const token = Buffer.from(`${input.basicAuth.username}:${input.basicAuth.password}`).toString('base64');",
   "ASCII/structural — base64 encode of operator-supplied basic-auth, not crawled text"],
  ["packages/engine/src/url-canonical.ts :: if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);",
   "ASCII/structural \u2014 hex, percent-encoding, punctuation, a date prefix or a file extension"]
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== '__fixtures__') sourceFiles(p, out);
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Every char-index cut in scanned source as `relativePath :: <trimmed line>`. Comments excluded. */
function foundCuts(): string[] {
  const hits: string[] = [];
  const files = ROOTS.flatMap((r) => sourceFiles(resolve(REPO, r)));
  for (const rf of ROOT_FILES) {
    try {
      readFileSync(resolve(REPO, rf), 'utf8');
      files.push(resolve(REPO, rf));
    } catch {
      /* absent is fine — the set-equality below covers whatever exists */
    }
  }
  {
    for (const file of files) {
      const rel = relative(REPO, file).replace(/\\/g, '/');
      for (const raw of readFileSync(file, 'utf8').split('\n')) {
        const line = raw.trim();
        if (line.startsWith('*') || line.startsWith('//') || line.startsWith('/*')) continue;
        if (isCut(line)) hits.push(`${rel} :: ${line.replace(/\s+/g, ' ')}`);
      }
    }
  }
  return hits.sort();
}

describe('GUARD: crawled-text cuts are inventoried, not incidental', () => {
  it('every char-index cut in every persisting/rendering root is classified', () => {
    // Exact set match BOTH ways: a new cut fails until classified, and a stale entry fails so the
    // inventory cannot rot into a list of things that no longer exist.
    expect(foundCuts()).toEqual(INVENTORY.map(([entry]) => entry).sort());
  });

  it('the DETECTOR fires on every idiom that was verified to evade it', () => {
    // Each of these was appended to a scanned file in review and the guard stayed green; two of them
    // were VERIFIED to split surrogate pairs on crawled text. A guard that enumerates method names
    // rather than the operation is a guard that has not been tested against a motivated edit.
    const evasions = [
      "const cut = v.replace(/^([\\s\\S]{0,100})[\\s\\S]*$/, '$1');",
      "const cut = v.match(/[\\s\\S]{0,100}/)![0];",
      "const cut = v['slice'](0, 100);",
      "const TRUNC_RE = /^([\\s\\S]{0,500})[\\s\\S]*$/;",
      "const cut = Buffer.from(v, 'utf16le').toString('utf16le', 0, 200);",
      'const cut = v.slice?.(0, 100);',
      'const cut = String.prototype.slice.call(v, 0, 100);',
      "const cut = Buffer.from(v, 'utf16le').subarray(0, n).toString('utf16le');",
      'const cut = v.slice(0, 100);', // the plain form, as a positive control
      'const cut = v.substring(0, 100);',
      'const cut = v.substr(0, 100);',
    ];
    for (const line of evasions) {
      expect(isCut(line), `detector must fire on: ${line}`).toBe(true);
    }
  });

  it('the DETECTOR does not fire on ordinary code (it must stay usable)', () => {
    // A detector that fires on everything gets suppressed, which is the same as not having one.
    for (const line of [
      'const parts = url.split("/");',
      'const ok = text.includes("x");',
      "const n = raw.replace(/\\s+/g, ' ');",   // replace WITHOUT a bounded quantifier
      'const m = s.match(/^https?:/);',          // match WITHOUT a bounded quantifier
      'const arr = [...items];',
    ]) {
      expect(isCut(line), `detector must NOT fire on: ${line}`).toBe(false);
    }
  });

  it('the guard is actually looking at code (fails loud if a root moves)', () => {
    // Without this, a renamed directory empties the scan and the set-equality above passes as soon as
    // the inventory is emptied to match — a guard that guards nothing, silently.
    expect(foundCuts().length).toBeGreaterThan(40);
  });

  it('every SPEC 05 crawled string is bounded AT THE SOURCE, not downstream', () => {
    // The design this round settled on: bound once where PageAiSignals and AiFinding are built, so
    // persist/projection/packets/whatAiSees/snapshot inherit bounded data. Capping only downstream is
    // what let a 500-finding cap serialise to 99.76 MB.
    const read = (rel: string) => readFileSync(resolve(REPO, rel), 'utf8');
    expect(read('packages/engine/src/analysis/ai-readiness/page-signals.ts')).toContain('AI_TITLE_MAX_BYTES');
    expect(read('packages/engine/src/analysis/ai-readiness/assemble.ts')).toContain('AI_TITLE_MAX_BYTES');
    expect(read('packages/engine/src/analysis/ai-readiness/assemble.ts')).toContain('AI_URL_MAX_BYTES');
    expect(read('packages/engine/src/analysis/ai-readiness/assemble.ts')).toContain('AI_TEXT_MAX_BYTES');
    expect(read('packages/engine/src/analysis/ai-readiness/excerpt.ts')).toContain('toPersistableText');
    expect(read('packages/engine/src/analysis/ai-readiness/legibility.ts')).toContain('toPersistableText');
    // The simulator must read the BOUNDED title off the signals, never the raw pages.title row value.
    expect(read('apps/web/lib/ai-readiness-packets.ts')).toContain('p.aiSignals.title');
  });

  it('the homepage-entity signal is decided BEFORE the storage cap, never from the capped array', () => {
    // Reading it off `types` let a storage cap emit a factually false `missing_entity_link` and move
    // the score by 3 points. `assemble` must consult the boolean.
    const assemble = readFileSync(resolve(REPO, 'packages/engine/src/analysis/ai-readiness/assemble.ts'), 'utf8');
    expect(assemble).toContain('hasEntityType');
    expect(assemble).not.toMatch(/jsonLd\.types\.some/);
  });

  it('no module reimplements the surrogate check instead of importing it', () => {
    // The original fix was a local surrogate-aware clamp in report-snapshot.ts: correct, and useless
    // everywhere else. A copy in one file is how a class stays open.
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of sourceFiles(resolve(REPO, root))) {
        const rel = relative(REPO, file).replace(/\\/g, '/');
        if (rel.endsWith('packages/engine/src/text-safety.ts')) continue;
        if (/0xd800|0xdbff|0xdc00|0xdfff/i.test(readFileSync(file, 'utf8'))) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * Resolve a relative or `@/`-aliased import specifier to a file under apps/web, or null.
 * Mirrors the resolution Next/webpack performs; extension-less and directory-index forms included.
 */
function resolveImport(fromFile: string, spec: string): string | null {
  const WEB = resolve(REPO, 'apps/web');
  let base: string;
  if (spec.startsWith('@/')) base = join(WEB, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(fromFile, '..', spec);
  // Workspace packages resolve through tsconfig `paths` and ARE real runtime modules — truncating the
  // walk at them hid `inngest/audit.ts`, which imports the barrel.
  else if (spec === '@crawlmouse/types') base = resolve(REPO, 'packages/types/src/index');
  else if (spec.startsWith('@crawlmouse/inngest')) {
    const sub = spec.slice('@crawlmouse/inngest'.length).replace(/^\//, '') || 'index';
    base = resolve(REPO, 'inngest', sub);
  } else return null; // any other bare specifier is a third-party package
  // next.config.ts sets extensionAlias so './foo.js' resolves to foo.ts at build time.
  const withoutJs = base.endsWith('.js') ? base.slice(0, -3) : base;
  for (const cand of [withoutJs, `${withoutJs}.ts`, `${withoutJs}.tsx`]) {
    try {
      if (readFileSync(cand, 'utf8')) return cand;
    } catch {
      /* try the next candidate */
    }
  }
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    try {
      if (readFileSync(cand, 'utf8')) return cand;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/**
 * Every RUNTIME import specifier in a file — static, dynamic and require, in either quote style.
 *
 * `import type` / `export type` are excluded because TypeScript ERASES them: they carry no module into
 * the bundle. Including them produced a real false positive — `ResultView.tsx` does
 * `import type { ClientAuditV2 } from '@/lib/audit-stream-projection'`, which transitively "reaches"
 * `ai-readiness-packets.ts` and its engine import, while `next build` passes because none of that
 * survives compilation. A guard that cries wolf on erased edges is a guard that gets suppressed.
 */
function importSpecifiers(src: string): string[] {
  // Strip MULTI-LINE `import type { … } from '…'` too, not just single-line: five web files use the
  // multi-line form, and treating them as runtime edges produced false positives.
  const runtime = src
    .replace(/^\s*(import|export)\s+type\s[\s\S]*?from\s*['"][^'"]+['"];?/gm, '')
    .split('\n')
    .filter((l) => !/^\s*(import|export)\s+type\s/.test(l))
    .join('\n');
  const out: string[] = [];
  const patterns = [
    /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g,
    /require\s*\(\s*['"]([^'"]+)['"]/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(runtime)) !== null) out.push(m[1]!);
  }
  return out;
}

/**
 * The set of files reachable from ANY `'use client'` component, by walking the real import graph
 * transitively. This is DERIVED, not declared: the previous version hardcoded seven filenames, none of
 * which had ever imported the engine barrel, so its assertion was structurally incapable of failing —
 * it would not have caught the very break it was written for.
 */
function clientReachable(): Set<string> {
  const seen = new Set<string>();
  const queue: string[] = [];
  // Seed from EVERY 'use client' file under apps/web — not two directories. `lib/trpc/Provider.tsx`
  // is the client boundary on every page and is imported by the SERVER `app/layout.tsx`, so a
  // directory-limited seed never reached it: a barrel import there passed the guard while `next build`
  // failed. The guard existed to catch exactly that shape.
  for (const dir of ['apps/web/app', 'apps/web/components', 'apps/web/lib']) {
    for (const file of sourceFiles(resolve(REPO, dir))) {
      if (/^['"]use client['"]/m.test(readFileSync(file, 'utf8'))) queue.push(file);
    }
  }
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
      const target = resolveImport(file, spec);
      if (target && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

/**
 * Tested against the EXTRACTED SPECIFIERS, not raw file text. Matching raw text flagged
 * `apps/web/lib/limits.ts`, which merely mentions `packages/engine/src/grade.ts` in a comment — a
 * false positive, and a guard that cries wolf is a guard that gets suppressed. Going through
 * `importSpecifiers` also inherits its type-erasure handling for free.
 */
const isBarrelSpecifier = (spec: string): boolean =>
  spec === '@crawlmouse/engine' || /packages\/engine\/src/.test(spec);

describe('GUARD: the engine barrel never reaches the client bundle', () => {
  // The barrel re-exports ssrf-guard / safe-fetch / crawler, which import node:dns, node:net,
  // node:http, node:https and node:crypto. One import from a module a client component can reach makes
  // `next build` fail with UnhandledSchemeError — and had it resolved, the SSRF allow/deny logic would
  // have shipped to every visitor's browser. Vitest resolves `node:` specifiers happily, so the whole
  // suite stayed green against a branch that could not deploy.

  it('the traversal genuinely reaches lib modules (it is capable of failing)', () => {
    // Proof the walk works, pinned against the EXACT file whose barrel import broke the build in
    // review: `AuditView.tsx` ('use client') imports `lib/audit-activity.ts`. If this stops being
    // reachable, the assertion below has silently stopped guarding anything.
    const reachable = clientReachable();
    const rels = [...reachable].map((f) => relative(REPO, f).replace(/\\/g, '/'));
    expect(rels).toContain('apps/web/lib/audit-activity.ts');
    expect(rels.length).toBeGreaterThan(30); // a real graph, not a handful of entrypoints
  });

  it('no module reachable from a client component imports the engine barrel', () => {
    const offenders = [...clientReachable()]
      .filter((f) => importSpecifiers(readFileSync(f, 'utf8')).some(isBarrelSpecifier))
      .map((f) => relative(REPO, f).replace(/\\/g, '/'))
      .sort();
    expect(offenders).toEqual([]);
  });

  it('the specifier matcher catches every import form, including the ones that evade `from`', () => {
    // A dynamic import has no `from`, and double quotes evade a single-quoted literal match.
    for (const line of [
      "import { x } from '@crawlmouse/engine';",
      'import { x } from "@crawlmouse/engine";',
      "const m = await import('@crawlmouse/engine');",
      "export * from '@crawlmouse/engine';",
      "const m = require('@crawlmouse/engine');",
    ]) {
      expect(importSpecifiers(line), line).toContain('@crawlmouse/engine');
    }
    // …and NOT the erased forms, which carry no module into the bundle.
    for (const line of [
      "import type { X } from '@crawlmouse/engine';",
      "export type { X } from '@crawlmouse/engine';",
    ]) {
      expect(importSpecifiers(line), line).not.toContain('@crawlmouse/engine');
    }
  });
});

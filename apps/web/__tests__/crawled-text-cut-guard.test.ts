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
const ROOT_FILES = [
  'apps/web/middleware.ts',
  'apps/web/instrumentation.ts',
  'apps/web/instrumentation-client.ts',
];
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
const CUT_HOISTED_RE =
  /^\s*(const|let|var)\s+\w*(TRUNC|CUT|CAP|LIMIT|MAX)\w*\s*=\s*\/.*\{\s*\d*\s*,?\s*\d+\s*\}/i;
// NOT detected, deliberately: a manual `for (i<cap) out += v.charAt(i)` accumulation loop. Every
// line-based pattern for it also matches legitimate single-character reads (`charAt(0)` for an
// initial, `charCodeAt(i)` inside text-safety itself), so the rule would be suppressed within a week.
// Logged as FU-8 with the verified evasion rather than shipped as noise.
const isCut = (line: string): boolean =>
  CUT_METHOD.test(line) ||
  CUT_REGEX.test(line) ||
  CUT_BYTES.test(line) ||
  CUT_COMPUTED.test(line) ||
  CUT_HOISTED_RE.test(line);

/** [ "<path> :: <source line>", "why it is safe" ] — the auditable inventory. */
const INVENTORY: [entry: string, why: string][] = [
  [
    'apps/web/lib/v2/account/sites-test-support.ts :: [accountId, tier, g.sites, g.seats, g.competitorsPerSite, `sub_${randomUUID().slice(0, 8)}`],',
    'STRING slice of a `randomUUID()` (or a site id, also a UUID) in PGlite test seeding: `[0-9a-f-]` only, never crawled text, and written only to a test database (CC-26b).',
  ],
  [
    'apps/web/lib/v2/account/sites-test-support.ts :: const email = `${tag}-${randomUUID().slice(0, 8)}@example.com`;',
    'STRING slice of a `randomUUID()` (or a site id, also a UUID) in PGlite test seeding: `[0-9a-f-]` only, never crawled text, and written only to a test database (CC-26b).',
  ],
  [
    'apps/web/lib/v2/account/sites-test-support.ts :: const host = `${id.slice(0, 8)}.example`;',
    'STRING slice of a `randomUUID()` (or a site id, also a UUID) in PGlite test seeding: `[0-9a-f-]` only, never crawled text, and written only to a test database (CC-26b).',
  ],
  [
    'apps/web/lib/v2/copy/notices.ts :: const capitalised = (t: string) => t[0]!.toUpperCase() + t.slice(1);',
    'STRING slice of our own notice copy (`NOTICE_LINES`, CC-26b), never crawled text: its first character is ASCII, so the cut after it cannot split a surrogate pair.',
  ],
  [
    "apps/web/lib/v2/rewrites.ts :: path.length > 2 && path.endsWith('/') ? path.slice(0, -1) : path;",
    'STRING slice of a request path in the middleware, to drop one trailing ASCII `/` before matching `V2_REWRITES` (CC-26b). Not crawled text, never persisted or rendered.',
  ],
  [
    "apps/web/lib/v2/rewrites.ts :: ? [path, withoutSlash(path.slice(0, -'.rsc'.length))]",
    'STRING slice of a request path in the middleware, dropping the ASCII `.rsc` suffix before matching (CC-26b). Not crawled text, never persisted or rendered.',
  ],
  [
    'packages/engine/src/v2/build/plan.ts :: .slice(0, STAGE1_CHALLENGED)',
    'ARRAY slice of PageResult rows: the first STAGE1_CHALLENGED challenged pages, in URL order, for the ' +
      'stage-1 access sample (CC-20a). No string is indexed.',
  ],
  [
    'packages/engine/src/v2/build/plan.ts :: list.slice(0, n).forEach((p) => room() && take(p, 2, why));',
    'ARRAY slice of PageResult rows: the first n of a ranked list (hubs, deepest, newest) for the ' +
      'stage-2 sample (CC-20a). No string is indexed.',
  ],
  [
    'packages/engine/src/v2/build/plan.ts :: return { stage1, stage2_needed, stage2: picked.slice(stage1.length) };',
    'ARRAY slice of the sampled-page records: the ones taken after stage 1 (CC-20a). No string is indexed.',
  ],
  [
    'packages/engine/src/v2/build/record.ts :: const top = ranks.slice(0, hubs).reduce((n, v) => n + v, 0);',
    "ARRAY slice of PageRank numbers, sorted high to low: v1's top hub tier, summed for Check.structure " +
      '(CC-20a). No string is indexed.',
  ],
  [
    "apps/web/lib/v2/pipeline/expire.ts :: error: cause instanceof Error ? cause.message.slice(0, 200) : 'not an Error',",
    'NOT A CUT of crawled text. The message of an error thrown by the evidence store or the database ' +
      'when the expiry could not delete a site, bounded for the report line. It holds no page text.',
  ],
  [
    'apps/web/lib/v2/pipeline/load.ts :: const chunk = values.slice(i, i + VALUES_PER_REQUEST);',
    'ARRAY slice of the ids a read filters on, VALUES_PER_REQUEST at a time so the URL stays short ' +
      '(CC-20b); every chunk is read. No string is indexed.',
  ],
  [
    'apps/web/lib/v2/pipeline/rows.ts :: : `${offset.slice(0, 3)}:${offset.slice(3)}`;',
    "Splits a UTC offset Postgres wrote (`+0530` → `+05:30`), matched first by DB_TIMESTAMP; the database's " +
      'own text, not crawled text, and nothing is dropped (CC-20b).',
  ],
  [
    'apps/web/lib/v2/pipeline/rows.ts :: return `${whole.toISOString().slice(0, 19)}${fraction}Z`;',
    "The whole seconds of an ISO instant the code just made, with Postgres's own fraction put back " +
      '(CC-20b). Not crawled text.',
  ],
  [
    'packages/engine/src/sitemap.ts :: return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date',
    'The date part of an ISO instant the code just made, compared with the date a sitemap wrote to ' +
      'refuse a date that does not exist (CC-20b). Nothing is kept from it.',
  ],
  [
    'apps/web/lib/refusal-copy.ts :: const named = kinds.slice(0, 3);',
    'ARRAY slice bounding the refusal copy to the three largest exclusion kinds so the sentence stays ' +
      'readable. Elements are `{ kind: PageKind; count: number }` — a closed enum from our own ' +
      'classifier plus an integer — so no string is indexed and no surrogate pair can be split. The ' +
      'bound is DISCLOSED in the rendered copy, and the disclosure now names the withheld PAGES as ' +
      'well as the kind count ("and 7 pages across 2 other kinds") so the printed counts sum to the ' +
      'printed population at ANY kind count — pinned by a 1..9-kind sweep that recomputes the sum from ' +
      'the rendered string. It previously disclosed only "and N other kinds", and the arithmetic did ' +
      'not reconcile above the bound. ' +
      '(A redundant no-arg `.slice()` was listed here too; it was removed rather than justified, and ' +
      'a `composition.slice(1)` capitalisation cut was rephrased away rather than inventoried — a cut ' +
      'that does not exist needs no review.)',
  ],
  [
    "apps/web/lib/refusal-copy.ts :: return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;",
    'ARRAY slice — all items but the last, so the list can be joined into English with a serial comma ' +
      '("a, b, and c"). The elements are phrases this module built from a closed enum plus integers, ' +
      'never crawled text, and `parts.length >= 3` is guaranteed by the two branches above it, so the ' +
      'slice can neither be empty nor drop a phrase. It exists because joining with `", "` alone ' +
      'shipped a comma splice to users on the flagship production row.',
  ],
  [
    'apps/web/lib/refusal-copy.ts :: const restPages = kinds.slice(3).reduce((n, e) => n + e.count, 0);',
    'ARRAY slice, the complement of the one above: the kinds NOT named individually, summed so the ' +
      'copy can disclose how many pages they account for. Same element type — closed enum plus ' +
      'integer — so nothing is string-indexed. It reads the tail rather than dropping it, which is ' +
      'the point: this is what makes the withheld pages disclosable instead of silently missing.',
  ],
  [
    "inngest/persist-helpers.ts :: const tag = TRUNCATION_TAG_PREFIX + createHash('sha256').update(s).digest('hex').slice(0, TRUNCATION_TAG_HEX);",
    'STRING slice, but NOT over crawled text: the subject is the hex output of `createHash(...).' +
      "digest('hex')`, which is `[0-9a-f]` only. Every character is one ASCII byte and one UTF-16 " +
      'code unit, so a cut at index 8 cannot split a surrogate pair or a multi-byte sequence — the ' +
      'hazard this inventory exists for is absent by the alphabet, not by luck. The cut is a ' +
      'deliberate 8-hex truncation of a collision-resistant digest, used to TAG a truncated key so ' +
      'two long sections cannot persist under the same name; it is not itself a truncation of ' +
      'meaningful text.',
  ],
  [
    "apps/web/app/api/admin/takedown/process/route.ts :: const token = header.startsWith('Bearer ') ? header.slice(7) : '';",
    'ASCII/structural \u2014 hex, percent-encoding, punctuation, a date prefix or a file extension',
  ],
  [
    'apps/web/lib/security/route-policy.ts :: return matches(rest, path.slice(1));',
    'array slice \u2014 cannot split a surrogate pair',
  ],
  [
    'apps/web/app/api/audits/[id]/export/route.ts :: .slice()',
    'array slice \u2014 cannot split a surrogate pair',
  ],
  [
    "apps/web/app/api/reports/[slug]/logo/route.ts :: const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);",
    'ASCII/structural \u2014 hex, percent-encoding, punctuation, a date prefix or a file extension',
  ],
  [
    "apps/web/app/blog/[slug]/page.tsx :: const related = postsNewestFirst().filter((p) => p.slug !== meta.slug && !(p.tags ?? []).includes('research')).slice(0, 2);",
    'array slice \u2014 cannot split a surrogate pair',
  ],
  [
    'apps/web/app/embed/[domain]/route.ts :: return htmlResponse(noReportBadge(String(rawDomain).slice(0, 253)), 400);',
    'display-only, never persisted',
  ],
  [
    'apps/web/components/audit/ActivityFeed.tsx :: const visible = events.slice(-DISPLAY_CAP);',
    'array slice \u2014 cannot split a surrogate pair',
  ],
  [
    'apps/web/components/report/AiReadinessReportSection.tsx :: const shown = ordered.slice(0, REPORT_AI_MAX_FINDINGS);',
    'array slice \u2014 cannot split a surrogate pair',
  ],
  [
    'apps/web/components/report/ReportLegacyFallback.tsx :: Automated, deterministic analysis of publicly served HTML, as of {r.created_at.slice(0, 10)}.',
    'ASCII/structural \u2014 hex, percent-encoding, punctuation, a date prefix or a file extension',
  ],
  [
    'apps/web/components/report/sections.tsx :: const asOf = snapshot.mintedAt.slice(0, 10); // deterministic YYYY-MM-DD (no locale/tz variance)',
    'ASCII/structural \u2014 hex, percent-encoding, punctuation, a date prefix or a file extension',
  ],
  [
    'apps/web/components/ui/LocalTime.tsx :: {local ?? iso.slice(0, 10)}',
    'ASCII/structural \u2014 hex, percent-encoding, punctuation, a date prefix or a file extension',
  ],
  [
    'apps/web/lib/ai-readiness-packets.ts :: .slice(0, WHAT_AI_SEES_MAX_PAGES)',
    'array slice \u2014 cannot split a surrogate pair',
  ],
  [
    "apps/web/lib/ai-readiness-packets.ts :: data.push(dataLine('Structured data', sig.jsonLd.present ? (sig.jsonLd.valid ? `present: ${sig.jsonLd.types.slice(0, 10).join(', ') || 'untyped'}` : 'present but malformed') : 'none'));",
    'array slice \u2014 cannot split a surrogate pair',
  ],
  [
    'apps/web/lib/audit-activity.ts :: const feed = [...s.feed, ...fresh].slice(-MAX_FEED_LENGTH);',
    'array slice \u2014 cannot split a surrogate pair',
  ],
  [
    'apps/web/lib/audit-activity.ts :: label: String(e.label).slice(0, MAX_ACTIVITY_LABEL_LENGTH),',
    'crawled text, cut WITHOUT the shared helper \u2014 PRE-EXISTING, tracked as FU-7',
  ],
  [
    'apps/web/lib/audit-crawl-health-telemetry.ts :: const safeUrl = url.slice(0, MAX_URL);',
    'crawled text, cut WITHOUT the shared helper \u2014 PRE-EXISTING, tracked as FU-7',
  ],
  [
    'apps/web/lib/audit-failure-sentry.ts :: extra: { auditId, reason: reason.slice(0, 500) },',
    'crawled text, cut WITHOUT the shared helper \u2014 PRE-EXISTING, tracked as FU-7',
  ],
  [
    'apps/web/lib/v2/account/deletion-ports.ts :: const { error } = await sb.storage.from(bucket).remove(names.slice(i, i + REMOVE_BATCH));',
    'array slice (a batch of Storage object names) \u2014 cannot split a surrogate pair',
  ],
  [
    'apps/web/lib/audit-stream-projection.ts :: .slice(0, AI_CLIENT_MAX_FINDINGS),',
    'array slice \u2014 cannot split a surrogate pair',
  ],
  [
    'apps/web/lib/billing/clock.ts :: return due.slice(0, limit).map(({ accountId, kind }) => ({ accountId, kind }));',
    'array slice \u2014 cannot split a surrogate pair',
  ],
  [
    'apps/web/lib/billing/csv.ts :: return raw.length > max ? `${raw.slice(0, max)}\u2026` : raw;',
    'crawled text, cut WITHOUT the shared helper \u2014 PRE-EXISTING, tracked as FU-7',
  ],
  [
    'apps/web/lib/findings.ts :: const shown = isPro || uncapped ? rows : rows.slice(0, freeLimit);',
    'array slice \u2014 cannot split a surrogate pair',
  ],
  [
    'apps/web/lib/graph-assembly.ts :: const outEdges: GraphEdge[] = amongSelected.slice(0, edgeCap).map((e) => ({ from: e.fromUrl, to: e.toUrl, nofollow: false }));',
    'array slice \u2014 cannot split a surrogate pair',
  ],
  [
    'apps/web/lib/graph-assembly.ts :: if (home) selected = [...selected.slice(0, Math.max(0, nodeCap - 1)), home];',
    'array slice \u2014 cannot split a surrogate pair',
  ],
  [
    'apps/web/lib/graph-assembly.ts :: let selected = ranked.slice(0, nodeCap);',
    'array slice \u2014 cannot split a surrogate pair',
  ],
  [
    "apps/web/lib/report-content.ts :: const list = top.length === 1 ? top[0] : `${top.slice(0, -1).join(', ')} and ${top[top.length - 1]}`;",
    'array slice \u2014 cannot split a surrogate pair',
  ],
  [
    'apps/web/lib/report-content.ts :: const top = issues.slice(0, 3).map((i) => i.phrase);',
    'array slice \u2014 cannot split a surrogate pair',
  ],
  [
    'apps/web/lib/report-snapshot.ts :: const findings: ReportSnapshotAiFinding[] = ordered.slice(0, MAX_AI_FINDINGS).map((f) => ({',
    'array slice \u2014 cannot split a surrogate pair',
  ],
  [
    "apps/web/lib/share-url.ts :: const clean = raw.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);",
    'ASCII/structural \u2014 hex, percent-encoding, punctuation, a date prefix or a file extension',
  ],
  [
    "apps/web/lib/share-url.ts :: const params = typeof search === 'string' ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search) : search;",
    'ASCII/structural \u2014 hex, percent-encoding, punctuation, a date prefix or a file extension',
  ],
  ['apps/web/lib/url-display.ts :: const rest = raw.slice(i);', 'display-only, never persisted'],
  [
    'inngest/persist-helpers.ts :: .slice(0, Math.max(0, AI_PERSIST_MAX_FINDINGS - reservedIdx.size));',
    'array slice \u2014 cannot split a surrogate pair',
  ],
  // SPEC 5.1a §12 — the fingerprint strata cap (boundFingerprintForPersist). An ARRAY slice over
  // {templateKey, discovered, selected} records, so it cuts between whole objects and cannot land
  // inside a string, let alone between the halves of a surrogate pair. `templateKey` is derived from
  // crawled URLs and is carried WHOLE.
  [
    'inngest/persist-helpers.ts :: .slice(0, FINGERPRINT_PERSIST_MAX_STRATA);',
    'array slice \u2014 cannot split a surrogate pair',
  ],
  [
    'apps/web/components/v2/screens/crawl/CrawlScreen.tsx :: const shown = frame.findings.slice(0, FINDINGS_SHOWN);',
    'ARRAY slice over the crawl frame\'s findings in the CC-22 preview screens (development-only, never persisted): no string is indexed, so no surrogate pair can be split. The strip shows the newest one and states the rest as a count ("and N earlier, all in the result").',
  ],
  [
    'apps/web/lib/v2/progress.ts :: .slice(-RECENT_FETCHES_IN_PROGRESS)',
    'ARRAY slice over the replayed fetch records in the CC-22 preview screens (development-only, never persisted): no string is indexed, so no surrogate pair can be split. It projects the last three onto the contract Progress snapshot, which carries a recent window by design.',
  ],
  [
    "apps/web/lib/v2/progress.ts :: const previousDone = steps.slice(0, i).every((s) => s.state === 'done');",
    'ARRAY slice over the six check phases (a closed enum) in the CC-22 preview screens (development-only, never persisted): no string is indexed, so no surrogate pair can be split. It reads the steps before one, to reject a stage out of order.',
  ],
  [
    'apps/web/lib/v2/sentences.ts :: return { fixes: bySeo.slice(0, i + 1), letter: letterFor(score + points) };',
    'ARRAY slice over fix records in the CC-22 preview screens (development-only, never persisted): no string is indexed, so no surrogate pair can be split. It returns the fewest fixes that reach the next letter band; the sentence states their count.',
  ],
  [
    'apps/web/lib/v2/synthesise.ts :: const slice = crawl.slice(prev.count, next.count);',
    'ARRAY slice over synthesised page records in the CC-22 preview screens (development-only, never persisted): no string is indexed, so no surrogate pair can be split. It takes the fetches between two timeline anchors to apportion their link counts.',
  ],
  [
    'apps/web/lib/v2/synthesise.ts :: return [...given, ...rest].slice(0, quotas[i]);',
    "ARRAY slice over synthesised page records in the CC-22 preview screens (development-only, never persisted): no string is indexed, so no surrogate pair can be split. It fills one template's share of the crawler-test sample; the sample size is the check's own pages_sampled, asserted after.",
  ],
  [
    'apps/web/lib/v2/view/crawl.ts :: const recent = state.fetches.slice(-LOG_LINES);',
    'ARRAY slice over the replayed fetch records in the CC-22 preview screens (development-only, never persisted): no string is indexed, so no surrogate pair can be split. The log shows the newest five, as the locked screen does, under a heading that says they are recent.',
  ],
  [
    "apps/web/lib/v2/view/crawl.ts :: return `${chars.slice(0, head).join('')}\u2026${chars.slice(start).join('')}`;",
    "CODE-POINT slice of a URL pathname for the CC-22 crawl screen's log (development-only, never persisted). The receiver is `[...path]`, an array of code points, so a pair cannot be split; a pathname from the URL parser is percent-encoded ASCII in any case. The cut is visible (an ellipsis) and the whole path is rendered beside it for screen readers.",
  ],
  [
    "apps/web/lib/v2/copy/dashboard.ts :: ? `${kinds.slice(0, -1).join(', ')}, and ${kinds.at(-1)}`",
    'ARRAY slice over the kinds of email an account gets (clauses the copy writes, no crawled text) in the CC-26 account previews (development-only, never persisted): no string is indexed, so no surrogate pair can be split. It joins every kind but the last before ", and", as the locked page lists them.',
  ],
  [
    'apps/web/lib/v2/view/dashboard.ts :: const shown = all.slice(-HISTORY_CHECKS);',
    'ARRAY slice over check records in the CC-26 account previews (development-only, never persisted): no string is indexed, so no surrogate pair can be split. The six latest checks the history chart draws; its title states how many checks there are in all.',
  ],
  [
    'apps/web/lib/v2/view/dashboard.ts :: const shown = resultChecks(v, site.id).slice(-HISTORY_CHECKS);',
    'ARRAY slice over check records in the CC-26 account previews (development-only, never persisted): no string is indexed, so no surrogate pair can be split. The same six checks, for the crawler-access-by-check rows under the chart.',
  ],
  [
    'apps/web/lib/v2/view/dashboard.ts :: rows: fixes.slice(0, TOP_FIXES).map((f) => ({',
    'ARRAY slice over fix records in the CC-26 account previews (development-only, never persisted): no string is indexed, so no surrogate pair can be split. The three fixes the first-run dashboard starts with; the line under them states how many more there are.',
  ],
  [
    'apps/web/lib/v2/view/site.ts :: const rest = byNumber.slice(SHOWN_FIXES);',
    'ARRAY slice over fix records in the CC-26 account previews (development-only, never persisted): no string is indexed, so no surrogate pair can be split. Every fix after the five the site page lists, shown as one row that states their count, sections and summed effect.',
  ],
  [
    'apps/web/lib/v2/view/site.ts :: const rows = byNumber.slice(0, SHOWN_FIXES).map((f) => fixRow(v, result, f, fixes));',
    'ARRAY slice over fix records in the CC-26 account previews (development-only, never persisted): no string is indexed, so no surrogate pair can be split. The five fixes the site page lists by number; the rest are the row above.',
  ],
  [
    'apps/web/lib/v2/view/site.ts :: const shown = all.slice(-SHOWN_CHECKS);',
    'ARRAY slice over check records in the CC-26 account previews (development-only, never persisted): no string is indexed, so no surrogate pair can be split. The six latest checks the grades and the crawler grid show; the heading states how many.',
  ],
  [
    'apps/web/lib/v2/view/agency-reports.ts :: const shown = sent.slice(0, SENT_SHOWN);',
    'ARRAY slice over report records on the client reports page: no string is indexed, so no surrogate pair can be split. The newest sent client reports the Sent table lists; the line over it states how many are shown of how many.',
  ],
  [
    'apps/web/lib/v2/view/free-fixes.ts :: return fixesAsOf(d, check).slice(0, FREE_FIXES);',
    'ARRAY slice over fix records in the v2 preview screens (development-only, never persisted): no string is indexed, so no surrogate pair can be split. The fixes the Free plan opens (FACTS: three per audit), the one rule the Result, the segments and the fix page share.',
  ],
  [
    'apps/web/lib/v2/view/result.ts :: const named = locked.slice(0, 2);',
    'ARRAY slice over fix records in the CC-22 preview screens (development-only, never persisted): no string is indexed, so no surrogate pair can be split. The two Pro fixes named in the table; the rest are one row that states their count.',
  ],
  [
    'apps/web/lib/v2/view/result.ts :: const rest = locked.slice(2);',
    'ARRAY slice over fix records in the CC-22 preview screens (development-only, never persisted): no string is indexed, so no surrogate pair can be split. Every fix after the named ones, shown as one row stating their count and summed points.',
  ],
  [
    "apps/web/lib/v2/view/segment/access.ts :: : `${clauses.slice(0, -1).join(', ')}, and ${clauses.at(-1)}.`;",
    'ARRAY slice over the headline’s clauses (sentences built from counts) in the CC-23 segment previews (development-only, never persisted): no string is indexed, so no surrogate pair can be split. It joins every clause but the last before “and”.',
  ],
  [
    'apps/web/lib/v2/view/segment/content.ts :: return words.length <= n ? text : text.slice(0, words[n - 1]!.index! + words[n - 1]![0].length);',
    "STRING cut on crawled text (a rendered page's `body_excerpt`) in the CC-23 content preview, display-only, never persisted. The cut ends where a `/\\S+/g` match ends: both halves of a surrogate pair are non-space, so a match never ends between them. The page says the excerpt is its first 150 words.",
  ],
  [
    'apps/web/lib/v2/view/segment/fixes.ts :: const named = pro.length <= NAMED_PRO ? pro : pro.slice(0, NAMED_PRO - 1);',
    'ARRAY slice over fix records in the CC-23 segment previews (development-only, never persisted): no string is indexed, so no surrogate pair can be split. The Pro fixes a section names; the rest are one row stating their count.',
  ],
  [
    'apps/web/lib/v2/view/segment/fixes.ts :: const rest = pro.slice(named.length);',
    'ARRAY slice over fix records in the CC-23 segment previews (development-only, never persisted): no string is indexed, so no surrogate pair can be split. Every Pro fix after the named ones, shown as one row stating their count and summed points.',
  ],
  [
    'apps/web/lib/v2/view/segment/nojs.ts :: .slice(0, -1)',
    'ARRAY slice over fix titles (sentence parts) in the CC-23 segment previews (development-only, never persisted): no string is indexed, so no surrogate pair can be split. It joins every free fix but the last before “and”.',
  ],
  // SPEC 5.1a §8 — the discovery cap (capDiscovered). An ARRAY slice over FrontierRecord objects, so
  // it cuts between whole records and cannot land inside a string. `url` and `template_key` hold
  // crawled text and are carried WHOLE.
  [
    'packages/engine/src/analysis/frontier-checkpoint.ts :: .slice(0, max);',
    'array slice \u2014 cannot split a surrogate pair',
  ],
  [
    'inngest/persist-helpers.ts :: const kept = all.filter((_, i) => keep.has(i)).slice(0, AI_PERSIST_MAX_FINDINGS);',
    'array slice — the final clamp on the findings array; cannot split a surrogate pair',
  ],
  [
    'inngest/progress.ts :: decodeURIComponent(raw.slice(0, cut));',
    'crawled text, cut WITHOUT the shared helper \u2014 PRE-EXISTING, tracked as FU-7',
  ],
  [
    'inngest/progress.ts :: if (ring.length > ringSize) ring = ring.slice(ring.length - ringSize);',
    'array slice \u2014 cannot split a surrogate pair',
  ],
  [
    "inngest/progress.ts :: return raw.slice(0, cut) + '\u2026';",
    'crawled text, cut WITHOUT the shared helper \u2014 PRE-EXISTING, tracked as FU-7',
  ],
  [
    "apps/web/components/ai/ai-view-logic.ts :: return `${chars.slice(0, head).join('').trimEnd()}\\u2026${chars.slice(chars.length - tail).join('').trimStart()}`;",
    'ARRAY slices over Array.from() code points (middle-ellipsis, keeps the distinguishing tail) \u2014 cannot split a surrogate pair; RENDER-only, never persisted',
  ],
  [
    "apps/web/components/ai/ai-view-logic.ts :: return chars.length > max ? `${chars.slice(0, max).join('').trimEnd()}\\u2026` : text;",
    'ARRAY slice over Array.from() code points \u2014 cannot split a surrogate pair; RENDER-only, never persisted',
  ],
  [
    'packages/engine/src/analysis/ai-readiness/classify.ts :: if (NOSCRIPT_JS_NOTICE.test($(el).text().slice(0, NOTICE_SCAN_CAP))) notice = true;',
    'scan buffer only \u2014 matched by a regex, never persisted',
  ],
  [
    'packages/engine/src/text-safety.ts :: piece = s.slice(i, i + 2); // a valid pair, kept whole',
    'the shared helper itself — takes a surrogate pair WHOLE, by construction',
  ],
  [
    "packages/engine/src/analysis/ai-readiness/finding-id.ts :: return createHash('sha256').update(`${kind}|${target ?? ''}`).digest('hex').slice(0, 16);",
    'ASCII/structural \u2014 hex, percent-encoding, punctuation, a date prefix or a file extension',
  ],
  [
    'packages/engine/src/analysis/ai-readiness/llms-txt.ts :: const scan = body.length > LLMS_TXT_SCAN_CAP ? body.slice(0, LLMS_TXT_SCAN_CAP) : body;',
    'scan buffer only \u2014 matched by a regex, never persisted',
  ],
  [
    "packages/engine/src/analysis/classify-pages.ts :: return make('duplicate', `duplicate_of:${rep.urlHash.slice(0, 12)}`, simhash, rep.urlHash);",
    'ASCII/structural \u2014 a sha256 hex identity hash, not crawled text; no surrogate can exist in it',
  ],
  [
    'packages/engine/src/analysis/ai-readiness/main-content-walk.ts :: if (text.length >= chars || k === parts.length) return text.slice(0, chars);',
    'hash input only \u2014 the crawl worker hashes this prefix (simhashForDedup tokenises letters and numbers, so a split pair is a separator); never persisted or rendered',
  ],
  [
    "packages/engine/src/analysis/simhash.ts :: const h = featureHash(tokens.slice(i, i + SHINGLE_SIZE).join(' '));",
    'array slice \u2014 cannot split a surrogate pair',
  ],
  [
    "packages/engine/src/crawler.ts :: const token = part.includes(':') ? part.slice(part.indexOf(':') + 1) : part;",
    'ASCII/structural \u2014 splits an X-Robots-Tag directive at its colon; the result is compared, never persisted',
  ],
  [
    'packages/engine/src/analysis/structure.ts :: .slice(0, topCount)',
    'array slice \u2014 cannot split a surrogate pair',
  ],
  [
    'packages/engine/src/analysis/structure.ts :: const topSum = sorted.slice(0, topCount).reduce((s, v) => s + v, 0);',
    'array slice \u2014 cannot split a surrogate pair',
  ],
  // SPEC 5.1a §7.2 added `declaredUrls` to this return so orphan triangulation can difference the
  // DECLARED set against link-reachability. The CUT is unchanged — still `.slice(0, pageCap)` over an
  // array of URLs — so the classification stands; only the line’s text moved, which is the human
  // review this guard exists to force, not a defect it caught.
  [
    'packages/engine/src/audit.ts :: return { seeds: [homepageUrl, ...ordered].slice(0, pageCap), sitemapUrlCount, declaredUrls: declared, robotsExcluded };',
    'array slice \u2014 cannot split a surrogate pair',
  ],
  [
    "packages/engine/src/crawler.ts :: return (pathname + search).slice(0, 200) || '/';",
    'ASCII/structural \u2014 hex, percent-encoding, punctuation, a date prefix or a file extension',
  ],
  [
    'packages/engine/src/crawler.ts :: return u.slice(0, 200);',
    'crawled text, cut WITHOUT the shared helper \u2014 PRE-EXISTING, tracked as FU-7',
  ],
  [
    'packages/engine/src/extract.ts :: return MEDIA_EXTENSIONS.has(last.slice(dot + 1).toLowerCase());',
    'ASCII/structural \u2014 hex, percent-encoding, punctuation, a date prefix or a file extension',
  ],
  [
    'packages/engine/src/projection/action-packet.ts :: .slice(0, cap);',
    'crawled text, cut WITHOUT the shared helper \u2014 PRE-EXISTING, tracked as FU-7',
  ],
  [
    "packages/engine/src/projection/action-packet.ts :: return u.replace(/[\\u0000-\\u001f\\u007f\\s`]+/g, '').slice(0, cap);",
    'crawled text, cut WITHOUT the shared helper \u2014 PRE-EXISTING, tracked as FU-7',
  ],
  [
    'packages/engine/src/projection/ledger.ts :: .slice(0, opts.linksPerFix);',
    'array slice \u2014 cannot split a surrogate pair',
  ],
  [
    "packages/engine/src/projection/ledger.ts :: if (words.length >= 3) candidates.push(words.slice(0, 3).join(' '));",
    'array slice \u2014 cannot split a surrogate pair',
  ],
  [
    "packages/engine/src/projection/ledger.ts :: return s.replace(/[\\s\\x00-\\x1f]+/g, ' ').trim().slice(0, cap);",
    'crawled text, cut WITHOUT the shared helper \u2014 PRE-EXISTING, tracked as FU-7',
  ],
  [
    'packages/engine/src/projection/projection.ts :: .slice(0, maxFixes);',
    'array slice \u2014 cannot split a surrogate pair',
  ],
  [
    'packages/engine/src/projection/relevance.ts :: return shared.slice(0, k);',
    'array slice \u2014 cannot split a surrogate pair',
  ],
  [
    'packages/engine/src/robots.ts :: const body = anchored ? rule.slice(0, -1) : rule;',
    'ASCII/structural \u2014 hex, percent-encoding, punctuation, a date prefix or a file extension',
  ],
  // The robots.txt parser's cuts. Each falls next to an ASCII character found with indexOf or
  // lastIndexOf, or at encodeInto's `read`, so none can fall between the halves of a surrogate pair.
  // Rule values are matched against paths, and Sitemap values are fetched (audit.ts, the
  // `discovered.sitemapUrls` loop).
  [
    'packages/engine/src/robots.ts :: const line = (hash === -1 ? rawLine : rawLine.slice(0, hash)).trim();',
    "ASCII/structural \u2014 cut at the first '#', found by indexOf",
  ],
  [
    'packages/engine/src/robots.ts :: const directive = line.slice(0, colon).trimEnd().toLowerCase();',
    "ASCII/structural \u2014 cut at the first ':', found by indexOf; compared with the directive names",
  ],
  [
    'packages/engine/src/robots.ts :: const value = line.slice(colon + 1).trim();',
    "ASCII/structural \u2014 cut just after the first ':', found by indexOf",
  ],
  [
    'packages/engine/src/robots.ts :: const kept = text.slice(0, read);',
    'the 500 KiB parse limit \u2014 `read` comes from TextEncoder.encodeInto, which stops before a ' +
      'character that does not fit, so it never ends inside a surrogate pair',
  ],
  [
    "packages/engine/src/robots.ts :: return kept.slice(0, Math.max(kept.lastIndexOf('\\n'), kept.lastIndexOf('\\r')) + 1);",
    'ASCII/structural \u2014 cut just after the last CR or LF, found by lastIndexOf',
  ],
  [
    'packages/engine/src/ssrf-guard.ts :: const ipv4CompatHex = lower.match(/^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);',
    'ASCII/structural — IPv6 hex parse, not a truncation',
  ],
  [
    'packages/engine/src/ssrf-guard.ts :: const ipv4MappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);',
    'ASCII/structural — IPv6 hex parse, not a truncation',
  ],
  [
    'packages/engine/src/ssrf-guard.ts :: const nat64 = lower.match(/^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);',
    'ASCII/structural — IPv6 hex parse, not a truncation',
  ],
  [
    'packages/engine/src/ssrf-guard.ts :: const sixToFour = lower.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(?::|$)/);',
    'ASCII/structural — IPv6 hex parse, not a truncation',
  ],
  // safeFetch's keepBytes (CC-12). Both cut raw bytes before they are decoded: the first keeps a
  // chunk's bytes up to the limit, the second trims what was kept back to a whole UTF-8 character.
  // The kept bytes are decoded as UTF-8, which never yields a lone surrogate.
  [
    'packages/engine/src/safe-fetch.ts :: if (cut) buf = buf.subarray(0, utf8Boundary(buf));',
    'byte cut at a UTF-8 character boundary, before decoding \u2014 cannot yield a lone surrogate',
  ],
  [
    'packages/engine/src/safe-fetch.ts :: const part = kept + chunk.length > keepBytes ? chunk.subarray(0, keepBytes - kept) : chunk;',
    'byte cut of an undecoded chunk, trimmed to a UTF-8 character boundary before decoding \u2014 ' +
      'cannot yield a lone surrogate',
  ],
  [
    'packages/engine/src/ssrf-guard.ts :: const firstByte = parseInt(lower.slice(0, 2), 16);',
    'ASCII/structural \u2014 hex, percent-encoding, punctuation, a date prefix or a file extension',
  ],
  [
    'packages/engine/src/ssrf-guard.ts :: const secondByte = parseInt(lower.slice(2, 4), 16);',
    'ASCII/structural \u2014 hex, percent-encoding, punctuation, a date prefix or a file extension',
  ],
  [
    "inngest/persist-results.ts :: const { error: pagesErr } = await sb.from('pages').insert(pageRows.slice(i, i + PAGE_INSERT_CHUNK));",
    'array slice — the insert chunking window; cannot split a surrogate pair',
  ],
  [
    'packages/engine/src/analysis/ai-readiness/excerpt.ts :: return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();',
    'cut at a space index, which can never fall inside a surrogate pair',
  ],
  [
    "packages/engine/src/crawler.ts :: const token = Buffer.from(`${input.basicAuth.username}:${input.basicAuth.password}`).toString('base64');",
    'ASCII/structural — base64 encode of operator-supplied basic-auth, not crawled text',
  ],
  [
    "packages/engine/src/url-canonical.ts :: if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);",
    'ASCII/structural \u2014 hex, percent-encoding, punctuation, a date prefix or a file extension',
  ],
  [
    "apps/web/lib/v2/mail/escape.ts :: return points.length <= max ? clean : `${points.slice(0, Math.max(0, max - 1)).join('')}…`;",
    'ARRAY slice of the code points of a string spread with `[...clean]` (CC-28 D3): each element is a ' +
      'whole code point, so the cut cannot split a surrogate pair. This is the bound mail templates use.',
  ],
  [
    "apps/web/lib/v2/mail/unsubscribe-token.ts :: body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));",
    'NOT A CUT. Decodes the whole base64url payload of an unsubscribe token we signed (CC-28 D7); nothing ' +
      'is dropped, and the payload holds a seat id, a kind and a time, no crawled text.',
  ],
  [
    "apps/web/lib/v2/mail/transport.ts :: providerId: typeof body?.id === 'string' ? body.id.slice(0, 200) : null,",
    "STRING slice of Resend's message id, bounded to the ledger column's 200 characters (CC-28 D1). " +
      'An id the provider issued, not crawled text.',
  ],
  [
    'apps/web/lib/v2/mail/headers.ts :: const local = value.slice(0, at);',
    'An address split at its one `@` after `isPlainAddress` accepted it (CC-28 security r1 N2): the address is the recipient, not crawled text, and is neither persisted nor rendered; the split point is an ASCII character.',
  ],
  [
    'apps/web/lib/v2/mail/headers.ts :: return at > 0 && local.length <= 64 && LOCAL.test(local) && DOMAIN.test(value.slice(at + 1));',
    'An address split at its one `@` after `isPlainAddress` accepted it (CC-28 security r1 N2): the address is the recipient, not crawled text, and is neither persisted nor rendered; the split point is an ASCII character.',
  ],
  [
    "apps/web/lib/v2/mail/send.ts :: createHash('sha256').update(key).digest('hex').slice(0, 16);",
    'The first 16 hex characters of a SHA-256 of the ledger key, for a log line (CC-28 test-quality r1): hex is ASCII, no crawled text.',
  ],
  [
    'apps/web/lib/v2/mail/templates/inspect.ts :: const attr = html.slice(i, k).toLowerCase();',
    'NOT crawled text: the HTML a template rendered, read by the test-support inspector (templates/inspect.ts, imported only by tests) to find link targets; nothing it cuts is persisted or rendered.',
  ],
  [
    'apps/web/lib/v2/mail/templates/inspect.ts :: const n = hex ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);',
    'NOT crawled text: the HTML a template rendered, read by the test-support inspector (templates/inspect.ts, imported only by tests) to find link targets; nothing it cuts is persisted or rendered.',
  ],
  [
    'apps/web/lib/v2/mail/templates/inspect.ts :: const name = html.slice(i, j).toLowerCase();',
    'NOT crawled text: the HTML a template rendered, read by the test-support inspector (templates/inspect.ts, imported only by tests) to find link targets; nothing it cuts is persisted or rendered.',
  ],
  [
    'apps/web/lib/v2/mail/templates/inspect.ts :: value = html.slice(i + 1, end === -1 ? n : end);',
    'NOT crawled text: the HTML a template rendered, read by the test-support inspector (templates/inspect.ts, imported only by tests) to find link targets; nothing it cuts is persisted or rendered.',
  ],
  [
    'apps/web/lib/v2/mail/templates/inspect.ts :: value = html.slice(i, e);',
    'NOT crawled text: the HTML a template rendered, read by the test-support inspector (templates/inspect.ts, imported only by tests) to find link targets; nothing it cuts is persisted or rendered.',
  ],
  [
    "apps/web/lib/v2/mail/templates/alert.ts :: ua === '' || (summary.startsWith(ua) && /^(?:[\\s:]|$)/.test(summary.slice(ua.length)));",
    'NOT A CUT that is kept: the rest of a change summary after a crawler name it starts with, only tested for a word boundary to decide whether to name the crawler again (CC-28 copy pass); nothing cut is rendered or persisted.',
  ],
  [
    "packages/engine/src/v2/grade/outcomes.ts :: : `${points.slice(0, MAX_TITLE_CHARS).join('')}…`;",
    'CODE-POINT cut, not a char-index one: the receiver is `[...text]`, an array of whole code points, so the cut cannot split a surrogate pair; `clean` (packets/text.ts) has already removed lone surrogates (`\\p{Cs}`). A fix title past MAX_TITLE_CHARS, marked with an ellipsis (CC-30, titleOf).',
  ],
  [
    'packages/engine/src/v2/packets/by-type/client-rendered-template.ts :: const shown = all.slice(0, PAGES_SHOWN);',
    'ARRAY slice of the record’s rendered pages (`RenderedPage[]`), to bound how many a packet lists; the line counts the rest. No string is cut (CC-30).',
  ],
  [
    'packages/engine/src/v2/packets/by-type/generic-anchor-text.ts :: const shown = links.slice(0, MAX_LINKS).map(({ to, text }): Line => {',
    'ARRAY slice of the hub’s generic links, to bound how many steps the packet lists; the packet counts the rest. No string is cut (CC-30).',
  ],
  [
    'packages/engine/src/v2/packets/compose.ts :: ...texts.slice(0, PACKET_BOUNDS.section_lines),',
    'ARRAY slice of a packet section’s lines at PACKET_BOUNDS.section_lines; the section’s last line counts the lines left out. No string is cut (CC-30).',
  ],
  [
    "packages/engine/src/v2/packets/compose.ts :: const kept = points.slice(0, PACKET_BOUNDS.line_chars).join('');",
    'CODE-POINT cut, not a char-index one: the receiver is `[...text]`, an array of whole code points, so the cut cannot split a surrogate pair; `clean` (packets/text.ts) has already removed lone surrogates (`\\p{Cs}`). A packet line past PACKET_BOUNDS.line_chars; the line says how long it was (CC-30).',
  ],
  [
    'packages/engine/src/v2/packets/html-checks.ts :: for (const item of items.slice(0, max)) {',
    'ARRAY slice of the URLs or phrases a verify command names (`listed`), bounded by count and by total length; `expect` says how many were left out. No string is cut (CC-30).',
  ],
  [
    'packages/engine/src/v2/packets/by-type/generic-anchor-text.ts :: const seen = named.slice(0, MAX_SEEN);',
    'ARRAY slice of the generic link texts the readable command names, to bound it; the line counts the rest. No string is cut (CC-30).',
  ],
  [
    'packages/engine/src/v2/packets/html-checks.ts :: .slice(1)',
    'STRING slice of `URL.search`, to drop its leading ASCII `?` before the query is sorted for comparison. Used to compare two URLs in the engine only; never persisted or rendered (CC-30, compared).',
  ],
  [
    "packages/engine/src/v2/packets/html-checks.ts :: const wordUrl = (target: string): string => url(target).word.slice(1, -1).replaceAll(`'\\\\''`, \"'\");",
    'STRING slice of a URL already written by `url` (packets/shell.ts): ASCII only, every other character percent-encoded, so no cut can split a surrogate pair. It removes the two ASCII quotes around the shell word (CC-30).',
  ],
  [
    'packages/engine/src/v2/packets/html-checks.ts :: text.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) =>',
    'NOT A CUT: a `{2}` quantifier matching the two hex digits of one percent-escape, to decode it for comparing two URLs. Nothing is truncated, and the result is compared, never persisted or rendered (CC-30, compared).',
  ],
  [
    'packages/engine/src/v2/packets/structure.ts :: const path = written.slice(new URL(written).origin.length);',
    'STRING slice of a URL already written by `url` (packets/shell.ts): ASCII only, every other character percent-encoded, so no cut can split a surrogate pair. It drops the origin, which ends on an ASCII boundary (CC-30, pathOf).',
  ],
  [
    "packages/engine/src/v2/packets/structure.ts :: const written = urlWord(target).word.slice(1, -1).replaceAll(`'\\\\''`, \"'\");",
    'STRING slice of a URL already written by `url` (packets/shell.ts): ASCII only, every other character percent-encoded, so no cut can split a surrogate pair. It removes the two ASCII quotes around the shell word (CC-30, pathOf).',
  ],
  [
    "packages/engine/src/v2/packets/test-support/content.ts :: ...(ours.match(new RegExp(`\\\\b1 (?:[a-z]+ ){1,2}(?:${COUNTED})\\\\b`, 'g')) ?? []),",
    'NOT A CUT: a `{1,2}` quantifier in a test helper’s pattern for "1 <plural>" wording; it matches, it does not truncate, and nothing is persisted (CC-30).',
  ],
  [
    "packages/engine/src/v2/packets/test-support/structure.ts :: res.writeHead(301, { location: body.slice(MOVED.length) }).end('moved');",
    'STRING slice in a test server: the redirect target after a fixed ASCII marker the test itself wrote. Test support only (CC-30).',
  ],
  [
    "packages/engine/src/v2/packets/structure.ts :: const tail = [...path].slice(-PATH_TAIL_CHARS).join('');",
    'CODE-POINT cut, not a char-index one: the receiver is `[...path]`, an array of whole code points, so the cut cannot split a surrogate pair. The end of a long path, kept so a readable command stays short (CC-30).',
  ],
  [
    "packages/engine/src/v2/packets/test-support/structure.ts :: ...(ours.match(new RegExp(`\\\\b1 (?:[a-z]+ ){1,2}(?:${COUNTED})\\\\b`, 'g')) ?? []),",
    'NOT A CUT: a `{1,2}` quantifier in a test helper’s pattern for "1 <plural>" wording; it matches, it does not truncate, and nothing is persisted (CC-30).',
  ],
  [
    "packages/engine/src/v2/packets/test-support/structure.ts :: const list = u('list').slice(0, -8);",
    'STRING slice in a test helper, of an ASCII URL the test itself builds, to make a second URL of the same length. Test support only (CC-30).',
  ],
  [
    "packages/engine/src/v2/packets/shell.ts :: return quoted([...clean(crawled)].slice(0, max).join(''));",
    'CODE-POINT cut, not a char-index one: the receiver is `[...text]`, an array of whole code points, so the cut cannot split a surrogate pair; `clean` (packets/text.ts) has already removed lone surrogates (`\\p{Cs}`). Crawled text in a verify command, cut to its bound before it is single-quoted (CC-30, crawledWord).',
  ],
  [
    'packages/engine/src/v2/packets/test-support/content.ts :: const shown = span.slice(1, -1);',
    'STRING slice in a test helper that removes the two ASCII backticks around a code span matched by a regex anchored on them; never persisted or rendered (CC-30).',
  ],
  [
    'packages/engine/src/v2/packets/text.ts :: const shown = items.slice(0, max).map((s) => s.text);',
    'ARRAY slice of `Safe` values in `list`, to bound how many a line names; the line counts the rest. No string is cut (CC-30).',
  ],
  [
    "packages/engine/src/v2/packets/text.ts :: return safe(`\\`${points.slice(0, max).join('')}\\` (cut from ${points.length} characters)`);",
    'CODE-POINT cut, not a char-index one: the receiver is `[...text]`, an array of whole code points, so the cut cannot split a surrogate pair; `clean` (packets/text.ts) has already removed lone surrogates (`\\p{Cs}`). Crawled text in a packet line, cut to its bound; the line says how long the text was (CC-30, code).',
  ],
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
      'const cut = v.match(/[\\s\\S]{0,100}/)![0];',
      "const cut = v['slice'](0, 100);",
      'const TRUNC_RE = /^([\\s\\S]{0,500})[\\s\\S]*$/;',
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
      "const n = raw.replace(/\\s+/g, ' ');", // replace WITHOUT a bounded quantifier
      'const m = s.match(/^https?:/);', // match WITHOUT a bounded quantifier
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
    expect(read('packages/engine/src/analysis/ai-readiness/page-signals.ts')).toContain(
      'AI_TITLE_MAX_BYTES',
    );
    expect(read('packages/engine/src/analysis/ai-readiness/assemble.ts')).toContain(
      'AI_TITLE_MAX_BYTES',
    );
    expect(read('packages/engine/src/analysis/ai-readiness/assemble.ts')).toContain(
      'AI_URL_MAX_BYTES',
    );
    expect(read('packages/engine/src/analysis/ai-readiness/assemble.ts')).toContain(
      'AI_TEXT_MAX_BYTES',
    );
    expect(read('packages/engine/src/analysis/ai-readiness/excerpt.ts')).toContain(
      'toPersistableText',
    );
    expect(read('packages/engine/src/analysis/ai-readiness/legibility.ts')).toContain(
      'toPersistableText',
    );
    // The simulator must read the BOUNDED title off the signals, never the raw pages.title row value.
    expect(read('apps/web/lib/ai-readiness-packets.ts')).toContain('p.aiSignals.title');
  });

  it('the homepage-entity signal is decided BEFORE the storage cap, never from the capped array', () => {
    // Reading it off `types` let a storage cap emit a factually false `missing_entity_link` and move
    // the score by 3 points. `assemble` must consult the boolean.
    const assemble = readFileSync(
      resolve(REPO, 'packages/engine/src/analysis/ai-readiness/assemble.ts'),
      'utf8',
    );
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
  for (const cand of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
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

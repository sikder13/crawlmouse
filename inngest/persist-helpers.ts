// Pure mappers from engine audit results to Supabase row shapes. Kept separate from
// the Inngest function so the link/finding endpoint resolution is unit-testable — this
// is the exact logic that silently dropped rows when the page-id map was incomplete.

import type { AiFinding, AiReadinessScore, FixDiagnosis, FixPrescription, PageAiSignals } from '@crawlmouse/types';
import { FINGERPRINT_PERSIST_MAX_STRATA, type CrawlFingerprint } from '@crawlmouse/types';
import { AI_FINDING_SEVERITY_RANK, AI_PERSIST_MAX_FINDINGS, rankIn } from '@crawlmouse/types';
import { toPersistableText } from '@crawlmouse/engine';
import { createHash } from 'node:crypto';

export interface ResultPage {
  url: string;
  urlHash: string;
  title?: string | null;
  statusCode: number;
  depth: number | null;
  inDegree: number;
  outDegree: number;
  isOrphan: boolean;
  // §1/§7 (v2 engine): per-page fetch outcome + whether the page was excluded from the grade.
  // Optional: the v1 engine path never sets these (rows then persist NULL / default false).
  fetchOutcome?: 'ok' | 'blocked' | 'dead';
  excludedFromGrade?: boolean;
  // SPEC 02 v1.2 (v2 engine): raw internal PageRank for the live graph. Undefined on v1 → NULL.
  pagerank?: number;
  // SPEC 05 §4 (v2 engine): per-page AI-legibility signals. Undefined on v1 / when disabled → NULL.
  aiSignals?: PageAiSignals;
}

export interface ResultLink {
  fromUrl: string;
  toUrl: string;
  anchorText: string | null;
  isGenericAnchor: boolean;
}

export interface ResultFinding {
  category: string;
  severity: string;
  pageUrl?: string | null;
  payload?: unknown;
}

export interface PageRow {
  audit_id: string; url: string; url_hash: string; title: string | null;
  status_code: number; depth: number | null; in_degree: number; out_degree: number; is_orphan: boolean;
  fetch_outcome: string | null; excluded_from_grade: boolean; pagerank: number | null;
  // SPEC 05 §4/§11: the PageAiSignals payload (jsonb). v2 sets it; v1 / extraction-disabled → NULL.
  ai_signals: unknown | null;
}
export interface FixRow {
  audit_id: string; fix_id: string; category: string; target_url: string; target_title: string | null;
  marginal_delta: number; effort: string | null; rationale: string | null; rank: number;
  is_free_fix: boolean; suggested_links: unknown; action_packet_body: string | null;
}
export interface LinkRow {
  audit_id: string; from_page_id: string; to_page_id: string; anchor_text: string | null; is_generic_anchor: boolean;
}
export interface FindingRow {
  audit_id: string; category: string; severity: string; page_id: string | null; payload: unknown;
}

export function buildPageRows(auditId: string, pages: ResultPage[]): PageRow[] {
  return pages.map((p) => ({
    audit_id: auditId,
    url: p.url,
    url_hash: p.urlHash,
    title: p.title ?? null,
    status_code: p.statusCode,
    depth: p.depth,
    in_degree: p.inDegree,
    out_degree: p.outDegree,
    is_orphan: p.isOrphan,
    // §1/§7: v2 sets these; v1 leaves them undefined -> NULL / default false (the column defaults),
    // so a v1 page row is persisted identically to before the additive migration.
    fetch_outcome: p.fetchOutcome ?? null,
    excluded_from_grade: p.excludedFromGrade ?? false,
    // SPEC 02 v1.2: raw PageRank for the live graph; v1 leaves it undefined -> NULL.
    pagerank: p.pagerank ?? null,
    // SPEC 05 §4: the per-page AI-legibility signals (incl. the bounded excerpt). v2 sets it; v1 -> NULL.
    ai_signals: p.aiSignals ?? null,
  }));
}

/**
 * Map the SPEC 02 §3 projection (the gap ledger) + §3–§5 cures into `fixes` rows. Each ledger
 * diagnosis becomes a row, joined to its prescription (suggestedLinks + action-packet body) by fixId;
 * rank is the ledger order (sorted by marginal impact); `is_free_fix` marks the rank-1 free cure. The
 * gated cure columns (suggested_links / action_packet_body) are written here but served ONLY through
 * the owner+Pro API projection (the table is service-role-only). v1 (no projection) → [] → no rows.
 */
export function buildFixRows(
  auditId: string,
  ledger: FixDiagnosis[],
  prescriptions: FixPrescription[],
  freeFixId: string | null,
): FixRow[] {
  const presByFix = new Map(prescriptions.map((p) => [p.fixId, p]));
  return ledger.map((d, i) => {
    const pres = presByFix.get(d.id);
    return {
      audit_id: auditId,
      fix_id: d.id,
      category: d.category,
      target_url: d.targetUrl,
      target_title: d.targetTitle,
      marginal_delta: d.marginalDelta,
      effort: d.effort,
      rationale: d.rationale,
      rank: i + 1,
      is_free_fix: freeFixId === d.id,
      suggested_links: pres ? pres.suggestedLinks : null,
      action_packet_body: pres ? pres.actionPacket.body : null,
    };
  });
}

/** Severity order for the persistence cap: keep what matters when we cannot keep it all. */

/** Packet-buildability is a function of kind + whether the finding targets a page — nothing else. */
const findingClass = (f: AiFinding): string => `${f.kind}|${f.targetUrl == null ? 'site' : 'page'}`;

/**
 * SPEC 05 — bound the AI-readiness ledger BEFORE it is written to `audits.ai_readiness`.
 *
 * This column is the source of truth every downstream surface reads: the client projection, the
 * packets, the simulator and the minted snapshot each had their own cap while the row itself had none.
 * Measured on the raw score at PRO_PAGE_CAP: 2000 pages ⇒ 6002 findings ⇒ 1.90 MB of jsonb, and 31.54
 * MB once `targetTitle` (raw crawled text, so attacker-chosen) is long.
 *
 * Two rules, and the second is the one that keeps the product honest:
 *  1. `totalFindings` is preserved untouched, so "showing N of M" never quietly reports the cap.
 *  2. One finding of every distinct (kind, targeted) class is RESERVED before the severity cut. Packet
 *     buildability depends only on that class, so the reservation makes
 *     `countBuildablePackets(persisted) > 0` exactly equivalent to the same test on the full ledger.
 *     Without it, a site with 500+ medium findings would lose every `missing_structured_data` (info,
 *     and packetable) to the cut, and the Pro wall would stop advertising packets that do exist.
 *
 * Deterministic (R1): stable severity sort over an already-deterministic assembler order.
 */
export function boundAiReadinessForPersist(score: AiReadinessScore): AiReadinessScore {
  const all = score.findings ?? [];
  const total = score.totalFindings ?? all.length;
  if (all.length <= AI_PERSIST_MAX_FINDINGS) return { ...score, totalFindings: total };

  const reservedIdx = new Set<number>();
  const seenClass = new Set<string>();
  all.forEach((f, i) => {
    const cls = findingClass(f);
    if (!seenClass.has(cls)) {
      seenClass.add(cls);
      reservedIdx.add(i);
    }
  });

  const rest = all
    .map((f, i) => ({ f, i }))
    .filter(({ i }) => !reservedIdx.has(i))
    // In-run values from a closed enum, so this site is not reachable — routed through the shared
    // helper anyway so the ordering has ONE definition and cannot drift from the three that are.
    .sort((a, b) => rankIn(AI_FINDING_SEVERITY_RANK, a.f.severity) - rankIn(AI_FINDING_SEVERITY_RANK, b.f.severity) || a.i - b.i)
    .slice(0, Math.max(0, AI_PERSIST_MAX_FINDINGS - reservedIdx.size));

  // Re-emit in the assembler's original order so the persisted ledger reads the same way the
  // unbounded one did — the cap changes WHICH findings survive, never how they are ordered.
  const keep = new Set<number>([...reservedIdx, ...rest.map(({ i }) => i)]);
  // Final clamp. The reserved set is not bounded by the cap — it is one entry per distinct (kind,
  // targeted) class — so with more classes than AI_PERSIST_MAX_FINDINGS the union would exceed it.
  // The AiFindingKind enum makes that unreachable today (~26 classes), which is exactly the kind of
  // invariant that stops being true without anyone noticing.
  const kept = all.filter((_, i) => keep.has(i)).slice(0, AI_PERSIST_MAX_FINDINGS);
  return { ...score, findings: kept, totalFindings: total };
}

/**
 * SPEC 5.1a §6.7/§12 — bound the crawl fingerprint's strata table BEFORE it is written to
 * `audits.fingerprint`.
 *
 * THE DEFECT THIS CLOSES, found while sizing the migration rather than by reasoning. The strata table
 * is one row per distinct `templateKey` and nothing bounded it, while its size tracks
 * `discoveredCount` — the PRE-SELECTION discovered set, which the page cap does not bound. Measured on
 * the live corpus (2026-08-04) the maximum `discovered_count` is **100 684**, so a site whose URLs
 * share no path structure would have written roughly 6 MB of jsonb onto a single audit row. The
 * unapplied fingerprint migration's own storage note claimed "~120 KB worst case" because it reasoned
 * from the page cap.
 *
 * WHY AT THE WRITE, not in the engine: the in-memory fingerprint stays complete so the backtest
 * harness can attribute a composition delta across every stratum; only the stored copy is capped.
 * Exactly the placement `boundAiReadinessForPersist` uses, for the same reason.
 *
 * WHAT IS KEPT: the LARGEST strata by discovery. The table's job is naming WHICH SECTIONS of a site
 * moved between two crawls, and a section of one URL is not a section anyone attributes a grade
 * movement to. Ties break on `templateKey` so the result is deterministic (R1).
 *
 * WHAT THE ROW CAP NEVER CHANGES: `digest`, `discoveredCount`, `selectedCount`, `seed`, `version`. The
 * digest is computed over the selected URL SET (`crawlSetDigest`), not over this table, so the cap
 * cannot change what "the same crawl" means — the one artifact that separates "the site changed" from
 * "we sampled differently" is unaffected by construction.
 *
 * ⚠ This paragraph read "WHAT IS NEVER TOUCHED" and named `seed` and `digest`, twelve lines above the
 * code that passes both through the sanitizer. A reviewer caught it. They are identity under the
 * transform — `seed` is a module constant, `digest` is short hex — so nothing behaved wrongly, but the
 * sentence described code that was not there. It now says what it means: the ROW CAP does not touch
 * them. The sanitizer touches everything, by construction (see `sanitizeStringsDeep`).
 *
 * NO SILENT TRUNCATION: `strataTotal` and `strataWithheld` record what was dropped. A table printing
 * 100 of 4 000 rows without saying so reads as "there were 100".
 */
/**
 * Per-string byte bound at the WRITE. A `templateKey` is `/segment/{slug}`-shaped, so this is
 * generous; it exists because intermediate segments are kept literal and a crawled URL may carry up to
 * `MAX_URL_LENGTH` (2048) of them. Measured before this bound: one 1,500-character segment produced a
 * 1,508-character key, so 100 strata could reach ~200 KB in a single `audits.fingerprint`.
 *
 * ⚠ THE WORST CASE AFTER THIS BOUND IS ~57 kB ON THE WIRE, NOT THE "~6.5 kB worst case, bounded" THE
 * MIGRATION NOTE STILL DOCUMENTS. This budget counts UTF-8 bytes, but JSON escaping DOUBLES `"` and
 * `\`, so a 256-byte key of quotes serialises to 513 bytes; 100 of them measured
 * `octet_length(v::text) = 57,579`, `pg_column_size = 34,618`. Reachable: `templateKeyFor`
 * percent-decodes, and 256 `"` cost 768 URL characters — well inside `MAX_URL_LENGTH`.
 *
 * The BEHAVIOUR is deliberately left alone (owner ruling): 57 kB is negligible beside the already
 * bounded `ai_readiness` (1.90 MB pre-bound), so budgeting on JSON-escaped bytes would be complexity
 * bought for nothing. What was wrong was the NUMBER, quoted as violated and then left standing.
 */
const FINGERPRINT_TEMPLATE_KEY_MAX_BYTES = 256;

/**
 * A truncated string SAYS SO, and says it uniquely.
 *
 * Cutting at a byte budget alone is a silent, LOSSY rename: `/aaa…(1500)/{slug}` and
 * `/aaa…(1500)x/{slug}` are different sections of a site that both persisted as the same 256-byte key.
 * The fingerprint's entire job is naming WHICH SECTIONS moved between two crawls, so two sections
 * sharing a name defeats it — and nothing recorded that a cut had happened (§10, no silent truncation).
 *
 * A string the transform CHANGED carries `~` + 8 hex of the sha256 of its RAW input. The tag makes the
 * change self-declaring, and hashing the raw input is what keeps distinct originals distinct.
 * Unchanged strings are returned untagged, so the common case is untouched.
 *
 * ⚠ THE TAG WAS APPLIED ONLY ON THE LENGTH PATH, AND CONTROL-STRIPPING IS EQUALLY LOSSY. A reviewer
 * proved the collision through the original `%00` vector: `templateKeyFor` yields `"/ section/{slug}"`
 * for one section and `"/section/{slug}"` for another, the strip made them identical, and both
 * persisted under one name with no tag — 1 distinct key of 2, in the artifact whose job is naming which
 * section moved. The docstring called the tag "collision-resistant between distinct originals", which
 * was true of the length path only: a class claim holding for the instance that had been looked at.
 * Hashing the RAW string rather than the sanitized one is what makes it true for both paths.
 *
 * 8 hex is 32 bits. That is ample against the 100-row cap and is chosen to keep the key readable, not
 * because 32 bits is cryptographically strong — the tag distinguishes sections, it does not authenticate.
 */
const TRUNCATION_TAG_PREFIX = '~';
const TRUNCATION_TAG_HEX = 8;

function boundPersistedString(s: string, maxBytes: number): string {
  const clean = toPersistableText(s, Number.MAX_SAFE_INTEGER);
  if (clean === s && Buffer.byteLength(clean, 'utf8') <= maxBytes) return clean; // untouched
  const tag = TRUNCATION_TAG_PREFIX + createHash('sha256').update(s).digest('hex').slice(0, TRUNCATION_TAG_HEX);
  // ⚠ THE TAG IS PART OF THE BUDGET, ALWAYS. An earlier version subtracted its width only on the CUT
  // path, so a string that was control-STRIPPED to just under the budget came back as `clean + tag` —
  // up to 265 bytes against a 256-byte bound. Reachable through the real producer on an ordinary URL:
  // `https://x.test/%01aaa…/some-slug-here` at 281 characters, well inside MAX_URL_LENGTH, persisted a
  // 265-byte key. The final check caught it; no test covered the band and the suite was green.
  //
  // `tag` is ASCII, so length === bytes. If a caller ever passes a budget too small to hold the tag,
  // BOUNDING WINS and the tag is dropped — a key that overruns its column is worse than one that does
  // not declare its cut. The only call site passes the 256 module constant, so that branch is
  // unreachable today; it exists so the function's stated job is true for every argument, not for the
  // one argument it happens to receive.
  if (maxBytes <= tag.length) return toPersistableText(clean, maxBytes);
  return toPersistableText(clean, maxBytes - tag.length) + tag;
}

/**
 * EVERY string in the object, sanitized BY CONSTRUCTION — not by a list someone has to remember.
 *
 * ⚠ THIS REPLACED A HAND-WRITTEN THREE-FIELD ALLOWLIST whose comment claimed exactly what this
 * function now does: *"EVERY crawled string in the fingerprint goes through the sanitizer… a future
 * field that forgets is the failure mode this is here to stop."* It was false — the allowlist mapped
 * `templateKey`, `seed` and `digest`, and `...fp` / `{...s}` passed every OTHER field through raw. A
 * reviewer proved it by adding one string field to the fingerprint and to a stratum: both reached
 * Postgres unsanitized and both threw `unsupported Unicode escape sequence`. The comment asserted a
 * class-level guarantee that only held for the instances that had already been looked at.
 *
 * The walk rebuilds the object from `Object.entries`, so nothing is spread through unexamined and
 * inherited properties are dropped. KEYS ARE SANITIZED TOO, not just values.
 *
 * ⚠ KEYS WERE NOT, AND TWO REVIEWERS FOUND IT INDEPENDENTLY. `Object.entries` yields `[k, v]` and only
 * `v` was walked, so a crawled string in KEY position reached Postgres raw:
 * `{"byTemplate": {"/a b": 3}}` → `unsupported Unicode escape sequence`, the original crash
 * verbatim. Unreachable then — `strata` is an array — but `Record<templateKey, count>` is the obvious
 * shape for this artifact, so it was one refactor away. A caveat four lines below the word EVERY does
 * not make EVERY true; sanitizing the key does.
 *
 * SCOPE, stated rather than implied. Non-string leaves are returned unchanged. Non-plain objects
 * (`Date`, `Map`, `Set`, `RegExp`, boxed primitives) are rebuilt as plain objects and lose their shape;
 * symbol-keyed and non-enumerable properties are dropped, which `JSON.stringify` also drops. The two
 * do NOT agree everywhere: an object carrying its own `toJSON` is walked as a plain object here and
 * serialised by its `toJSON` there, so a string it returns is never sanitized. Unreachable from
 * `fingerprintFor`, which builds plain objects — recorded because an earlier version of this comment
 * claimed the walk's reach *equals* what reaches the column, and a reviewer falsified it by varying
 * the object kind. There is NO depth or cycle guard: the producer
 * is `fingerprintFor` (`packages/engine/src/analysis/frontier.ts`), our own two-level constructor over
 * a `Map`, so neither is reachable from crawled input. The guard against that assumption being wrong
 * later is `safeFingerprintForPersist` below, not machinery here.
 */
function sanitizeStringsDeep<T>(value: T, maxBytes: number): T {
  if (typeof value === 'string') return boundPersistedString(value, maxBytes) as T;
  if (Array.isArray(value)) return value.map((v) => sanitizeStringsDeep(v, maxBytes)) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[boundPersistedString(k, maxBytes)] = sanitizeStringsDeep(v, maxBytes);
    }
    return out as T;
  }
  return value;
}

/**
 * SANITIZE AND BOUND THE FINGERPRINT AT THE PERSIST BOUNDARY — and ONLY here.
 *
 * ⚠ `templateKey` IS A CRAWLED STRING, and until it was actually persisted nobody had to treat it as
 * one. `templateKeyFor` percent-DECODES each path segment, so a link as ordinary as
 * `<a href="/%00section/some-slug">` on any page we crawl yields the key `"/\u0000section/{slug}"`
 * with a RAW NUL in it. Postgres rejects that in `jsonb` (`unsupported Unicode escape sequence`), the
 * completion `update` throws, `onFailure` marks the audit FAILED — a crawl that succeeded is
 * destroyed, triggered by one anchor tag, with no server cooperation required.
 *
 * It was unreachable while `analyzeCrawl` dropped the fingerprint; threading it is what made this
 * live, which is why the sanitization lands in the same change.
 *
 * SANITIZED HERE, NOT IN `templateKeyFor`. The in-memory key is the SELECTION IDENTITY — it decides
 * which URLs are sampled, so it is grade-affecting. Normalising it at the source would silently move
 * grades to fix a storage problem. `toPersistableText` is, by its own docstring, "THE one call every
 * crawled string bound for a database column must go through".
 */
export function boundFingerprintForPersist(fp: CrawlFingerprint): CrawlFingerprint {
  const all = fp.strata ?? [];
  const kept =
    all.length <= FINGERPRINT_PERSIST_MAX_STRATA
      ? all
      : [...all]
          .sort((a, b) => b.discovered - a.discovered || (a.templateKey < b.templateKey ? -1 : a.templateKey > b.templateKey ? 1 : 0))
          .slice(0, FINGERPRINT_PERSIST_MAX_STRATA);
  // Bound the ROWS first, then sanitize the WHOLE object in one pass. Order matters only for cost —
  // sanitizing 4,000 strata to throw 3,900 away would be wasted work — but the guarantee comes from the
  // walk covering every field that survives, including fields added after this line was written.
  const capped: CrawlFingerprint = {
    ...fp,
    strata: kept,
    ...(all.length > FINGERPRINT_PERSIST_MAX_STRATA
      ? { strataTotal: all.length, strataWithheld: all.length - kept.length }
      : {}),
  };
  return sanitizeStringsDeep(capped, FINGERPRINT_TEMPLATE_KEY_MAX_BYTES);
}

/**
 * NO DEFECT IN THIS FILE'S FINGERPRINT PATH CAN FAIL AN AUDIT.
 *
 * The fingerprint is diagnostic metadata: it names which sections of a site were sampled, so a later
 * crawl can tell "the site changed" from "we sampled differently". Nothing renders it, no client role
 * can read it, and no grade depends on it. A successful crawl — the expensive, user-visible thing — must
 * not be destroyed by a defect in that bookkeeping.
 *
 * That is the NUL lesson expressed as a structural property rather than as one more fix. The original
 * blocker was this shape: `templateKeyFor` percent-decoded a `%00`, the key reached `jsonb`, the
 * completion `update` threw, `onFailure` marked a completed audit FAILED. Each specific cause since —
 * unsanitized keys, a cycle, a future field of a shape the walk mishandles — has been closed on its
 * merits, but closing causes one at a time is what produced three gates of "the class, one radius
 * smaller". On any throw from the bound, the audit persists with `fingerprint` null and keeps its
 * grade, its pages, its links and its findings.
 *
 * ⚠ SCOPE, STATED EXACTLY, because an earlier version of this docstring claimed more than the code
 * does. It said "the CONSEQUENCE is closed: on ANY throw…". This wrapper covers throws from
 * `boundFingerprintForPersist` — the sanitize-and-bound path — and nothing else. The completion
 * `update` itself is outside it (`persist-results.ts`, `if (updateErr) throw`), so a value that this
 * file sanitizes without complaint and Postgres then rejects would still fail the audit, exactly as
 * before. A reviewer demonstrated one residual route: an object carrying its own `toJSON` passes the
 * walk untouched, and `JSON.stringify` then emits whatever `toJSON` returns. Not producer-reachable —
 * `fingerprintFor` builds plain objects — but the honest claim is "this path cannot fail an audit",
 * not "no fingerprint value can".
 *
 * Losing the fingerprint is cheap and visible — `fingerprint IS NULL` is queryable, and it was null on
 * every row in production until this branch. Losing the audit is neither.
 */
export function safeFingerprintForPersist(
  fp: CrawlFingerprint,
  onError?: (err: unknown) => void,
): CrawlFingerprint | null {
  try {
    return boundFingerprintForPersist(fp);
  } catch (err) {
    onError?.(err);
    return null;
  }
}

export function buildLinkRows(auditId: string, links: ResultLink[], urlToPageId: Map<string, string>): LinkRow[] {
  return links
    .map((l) => ({
      audit_id: auditId,
      from_page_id: urlToPageId.get(l.fromUrl),
      to_page_id: urlToPageId.get(l.toUrl),
      anchor_text: l.anchorText,
      is_generic_anchor: l.isGenericAnchor,
    }))
    .filter((r): r is LinkRow => Boolean(r.from_page_id && r.to_page_id));
}

export function buildFindingRows(auditId: string, findings: ResultFinding[], urlToPageId: Map<string, string>): FindingRow[] {
  return findings.map((f) => ({
    audit_id: auditId,
    category: f.category,
    severity: f.severity,
    page_id: f.pageUrl ? urlToPageId.get(f.pageUrl) ?? null : null,
    payload: f.payload ?? null,
  }));
}

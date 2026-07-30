# SPEC 05 — Stage 7 handoff (gate FAILED, 4 blocking). Resume-cold brief.

**Written 2026-07-27.** The Stage-7 close-out gate found four blocking defects. **The PR was not opened.**
This brief is written to be sufficient without any prior conversation.

---

## 1. Frozen state

| | |
|---|---|
| Branch | `ai/spec-05-readiness` |
| Worktree | `/home/udsik/nahl-clients-projects/crawlmouse-spec05` |
| HEAD | `e25a65e` (gate ran against `5cc33d1`; `e25a65e` adds only a doc-correction commit on top) |
| Commits vs `origin/main` | **41**, full history, never squashed |
| Rebased onto | `origin/main` @ `9bc12c5` |
| Backup tag | `backup/spec05-pre-rebase-a1bb5e7` |
| Working tree | clean |
| Pushed? | **No.** Nothing pushed, no PR, no merge. |

**Suite (all green — which is the problem: none of the four defects has a failing test):**
`engine 512` · `web 1222` · `inngest 115` · `scripts 5` · `typecheck 5/5` · `lint clean` ·
`pnpm build` passes (bare `build` fails on a **pre-existing** module-scope `new Stripe()` in
`/api/billing/checkout` without `STRIPE_SECRET_KEY`; passes with production-shaped env — not SPEC 05).

Node: `nvm use 22`. A stale `.next/types/routes.d.ts` in a fresh worktree throws bogus `RouteImpl`
typecheck errors — run `npx next typegen` before believing a typecheck failure.

**Leftover gate worktree** `/home/udsik/nahl-clients-projects/crawlmouse-gate` (detached at `5cc33d1`) —
remove with `git worktree remove` or reuse, but see §7.

---

## 2. The four BLOCKING defects

### B1 — Excerpt truncation cuts a surrogate pair → audit-fatal

**Where:** `packages/engine/src/analysis/ai-readiness/excerpt.ts:8-13` (`buildExcerpt`).
`.slice(EXCERPT_MAX_BYTES)` = 2000 **UTF-16 code units**; when the slice contains no space
(`lastSpace <= 0`) it returns the raw slice, which can end on a lone high surrogate.

**Measured (my own probe, see §2.5):** `excerptLen = 2000, loneSurrogate = true`.

**Why fatal:** the value is persisted into the `pages.ai_signals` **jsonb** column. Postgres rejects an
unpaired surrogate — verified against prod (`ezspnfeyzwsisymytssm`):
```sql
select ('{"excerpt":"' || E'\ud83d' || '"}')::jsonb;
-- ERROR 22P02: invalid input syntax for type json
-- DETAIL: Unicode low surrogate must follow a high surrogate.
```
Path: `buildPageRows` → `pages` insert → `inngest/persist-results.ts:74`
`if (pagesErr) throw new Error('pages insert failed: …')` → **the entire audit fails** (Inngest retries,
then `signal:audit-failed`). No page-level degradation.

**Reachability:** anyone can submit a URL they control (free tier, no auth). Innocently reachable on
unspaced scripts (CJK Ext-B) and emoji-dense pages.

### B2 — JSON-LD `@type` carries a lone surrogate → audit-fatal, 40-byte payload

**Where:** `packages/engine/src/analysis/ai-readiness/legibility.ts:42-57` (`analyzeJsonLd` → `collectTypes`).
`JSON.parse` **accepts** unpaired `\uXXXX` escapes and yields a lone-surrogate string, persisted verbatim
into `pages.ai_signals.jsonLd.types`.

**Measured:** input `<script type="application/ld+json">{"@type":"\ud800"}</script>` →
`types = ["\ud800"]`, `loneSurrogate = true`.

Same fatal path as B1 but **trivially triggerable, no length/whitespace precondition**. One poisoned page
anywhere on the site kills the whole audit.

### B3 — `jsonLd.types` unbounded in count and per-item length

**Where:** `packages/engine/src/analysis/ai-readiness/legibility.ts:46,54-56,59-71`. `types` is collected
from `@type` plus recursive `@graph`, deduped, persisted verbatim. No cap on element count, no cap on
string length, no recursion bound.

**Measured (mine):** 5000 `@graph` entries → `typesCount = 5000`, `JSON.stringify(aiSignals) = 284,541 bytes`
for ONE page.
**Measured (reviewer, 20000 entries):** **1,149,443 bytes for one page.**

`infra/supabase/migrations/20260708000001_spec05_ai_readiness.sql` states *"~2KB/page ⇒ ≤ ~1.2MB per
500-page audit."* At 1.15 MB/page × 500 the single `pages` insert body is **~575 MB** — OOM/timeout/reject,
failing the audit. Sub-fatal variants inflate 30-day storage with attacker-controlled data against the
≤18%-MRR ceiling.

Related, smaller: `apps/web/lib/ai-readiness-packets.ts:143` does `sig.jsonLd.types.join(', ')` and only
*then* caps at 200 chars — it materialises the full joined string first.

### B4 — `whatAiSees` unbounded on the SSE payload

**Where:** `apps/web/lib/audit-stream-projection.ts:169` → `apps/web/lib/ai-readiness-packets.ts:46`
(`buildWhatAiSees`). Maps **every** page; `EXCERPT_MAX_BYTES = 2000`, `PRO_PAGE_CAP = 2000`
(`apps/web/lib/limits.ts:3`).

**Measured by driving the real `projectAuditForClient`:**

| viewer / scale | `aiReadiness` total | `whatAiSees` | `aiPackets` | `score` |
|---|---|---|---|---|
| PRO owner, 2000 pages | **4.14 MB** | **4.03 MB** | 0.09 MB | 0.02 MB |
| PRO owner, 500 pages | 1.12 MB | 1.01 MB | 0.09 MB | 0.02 MB |
| FREE viewer (any scale) | 0.02 MB | 0 | 0 | 0.02 MB |

A ~4 MB single `event: done` line on **every** result-page load for a paying user; `WhatAiSeesSimulator`
then renders 2000 un-virtualized `<pre>` blocks (`<details>` hides but does not unmount). Free tier is
unaffected — the conversion spine is safe, the paid surface is not.

**The test that should have caught it** — `apps/web/lib/audit-stream-projection.test.ts:366`
(`bounds the SERIALIZED payload…`, asserts `< 60_000`) — holds `pageAiSignals` at **2 rows**, so the 4 MB
dominant term is structurally absent from the fixture. It passes for the wrong reason.

### 2.5 The reproduction probe (re-runnable)

Written to `packages/engine/src/__verify.test.ts`, run, then deleted. **Note the argument order:
`extractPage(html, baseUrl, opts)`** — reversing it yields a confusing `Invalid URL`.

```ts
import { describe, it, expect } from 'vitest';
import { extractPage } from './extract.js';
const lone = (s: string) => { for (let i=0;i<s.length;i++){const c=s.charCodeAt(i);
  if(c>=0xd800&&c<=0xdbff){const n=s.charCodeAt(i+1); if(!(n>=0xdc00&&n<=0xdfff)) return true; i++;}
  else if(c>=0xdc00&&c<=0xdfff) return true;} return false; };

// B2 — 40 bytes
const h2 = `<html><head><title>T</title><script type="application/ld+json">{"@type":"\ud800"}</script></head><body><main><p>${'word '.repeat(80)}</p></main></body></html>`;
extractPage(h2, 'https://ex.com/', {}).aiSignals!.jsonLd.types;   // ["\ud800"]

// B1 — unspaced astral text
const h1 = `<html><head><title>T</title></head><body><main><p>${'A' + '\u{1F600}'.repeat(1300)}</p></main></body></html>`;
extractPage(h1, 'https://ex.com/', {}).aiSignals!.excerpt;        // len 2000, lone surrogate

// B3 — unbounded types
const graph = Array.from({length:5000},(_,i)=>`{"@type":"${'T'.repeat(50)}${i}"}`).join(',');
const h3 = `<html><head><title>T</title><script type="application/ld+json">{"@graph":[${graph}]}</script></head><body><main><p>${'word '.repeat(80)}</p></main></body></html>`;
JSON.stringify(extractPage(h3,'https://ex.com/',{}).aiSignals).length;  // 284541
```

### 2.6 The fix shape (agreed direction, not yet implemented)

1. Extract the **surrogate-safe truncation** already written at `apps/web/lib/report-snapshot.ts:90-96`
   into a shared engine helper, and use it in `buildExcerpt` **and** on every string entering
   `jsonLd.types`. **Then audit EVERY `.slice()` on crawled text that lands in jsonb/text** — do not fix
   only the two known sites. `packages/engine/src/projection/action-packet.ts:26` (`sanitizeText`) is the
   same shape and pre-existing via `fixes.action_packet_body`.
2. Hard-cap `jsonLd.types` (≈ ≤20 entries, ≤100 chars each) and bound `collectTypes` recursion
   depth/node count.
3. Cap `buildWhatAiSees` (≈100 pages, worst-first by `pageClass`, `js_blind` first) and carry an honest
   `totalPages`, mirroring the existing `totalFindings` pattern.
4. Regression tests that (a) assert **every persisted crawled string is well-formed UTF-16**, (b) size the
   client payload at `PRO_PAGE_CAP` pages rather than 2, (c) plant a rogue field **inside**
   `accessMatrix.bots[i]` and `components.access` (see §3).
5. Then a **fresh gate** (see §7).

---

## 3. The two MAJOR test-quality gaps (mutations that survive a green suite)

### M1 — `hasMoreAiPackets` is completely unpinned

**Code:** `apps/web/lib/audit-stream-projection.ts:154`.
**Test that names it:** `apps/web/lib/audit-stream-projection.test.ts:380-390` —
*"counts packet-buildability from the FULL pre-cap ledger, so the Pro wall shape never shifts"*.

**Two surviving mutations:**
- `const hasMoreAiPackets = true;` (constant)
- `countBuildablePackets(boundedScore)` instead of `countBuildablePackets(score)` — i.e. **the exact
  pre-cap/post-cap distinction the test claims to pin**

**Cause:** the `buried` fixture is built from `AI_CLIENT_MAX_FINDINGS + 10` findings of kind
`missing_structured_data` **with** `targetUrl` — every one packetable (`FINDING_TO_PACKET`,
`apps/web/lib/ai-readiness-packets.ts:62`). The post-cap ledger therefore also yields packets, so
`.toBe(true)` holds under both branches. **No test anywhere asserts `hasMoreAiPackets === false`.**

**Live consequence of the surviving mutation:** the Pro wall (`AiReadinessSection.tsx:165`) advertises
"copy-paste AI fix packets" on a site with zero packetable findings.

**Fix:** fixture where the top-`AI_CLIENT_MAX_FINDINGS` are **non**-packetable
(`retrieval_bot_blocked` / `targetUrl: null`) and one packetable finding is buried past the cap; plus an
explicit `=== false` case.

### M2 — The snapshot depth-whitelist test skips `components` and `bots[i]`

**Code:** `apps/web/lib/report-snapshot.ts:127-160`. The comment claims the rebuild-to-depth is
*"Pinned by a nested rogue-field test"* and names components/basis/accessMatrix/llmsTxt.
**Test:** `apps/web/lib/report-snapshot.test.ts:281-295` plants rogue keys in `accessMatrix` (top level),
`llmsTxt`, `basis` — **not** in `components`, and **not inside a `bots[]` entry**.

**Two surviving mutations:**
- `report-snapshot.ts:131` — `components: { … }` → `components: c`
- `report-snapshot.ts:147` — `bots: (m.bots ?? []).map(…)` → `bots: m.bots ?? []`

Both typecheck (identical types) and both pass `toEqual`. No leak today (`AiBotAccess` and the component
shape are closed at exactly the whitelisted fields), but this is the *same* one-level-whitelist class an
earlier round already had to fix, on a **permanent, world-readable, immutable** artifact.

**Minor sibling (F6, no live exposure):** `clamp` on `b.note` (`:153`) and `wafNote` (`:157`) are unpinned —
both mutations to raw pass-through survive. Sources are static registries, so defense-in-depth only.

---

## 4. The migration gap — `20260727000001`

**File:** `infra/supabase/migrations/20260727000001_spec05_pages_ai_signals_privilege.sql`
(written this session, **NOT APPLIED** — migrations are owner-run).

**What it does:** revokes table-level SELECT on `public.pages` from `anon`/`authenticated` and re-grants an
explicit column list excluding `ai_signals`. (A bare `REVOKE SELECT (col)` is a **no-op** while the table
grant stands — Postgres unions table- and column-level grants. Same idiom as
`20260707000003_spec04_column_privilege_hardening.sql`.)

**Why it's needed — verified live on prod:**
```
has_column_privilege('authenticated','public.pages','ai_signals','SELECT') = true
has_column_privilege('anon',         'public.pages','ai_signals','SELECT') = true
has_column_privilege('authenticated','public.audits','ai_readiness','SELECT') = false   ← correct, via 20260707000003
```
`audits` was hardened by SPEC 04 so `ai_readiness` inherited **no** grant. `pages` was never converted, so
the new column inherited the default table grant. A signed-in **free** owner can therefore
`GET /rest/v1/pages?audit_id=eq.<own audit>&select=url,ai_signals` and bypass the Pro `whatAiSees` gate.

**Scope, stated honestly:** RLS `pages_via_audit` is `audits.user_id = auth.uid()`, so anon reads **0 rows**.
This is **paywall integrity, not cross-tenant exposure** — the data is the owner's own site's public text.

**The gaps:**
1. **Zero references repo-wide** outside the file itself: no guard test, no runbook entry, no spec mention.
   `docs/deploy/spec05-migration-runbook.md` documents only `20260708000001`.
2. **No guard test**, unlike its direct precedent `apps/web/__tests__/spec04-column-privilege-guard.test.ts`
   — which exists *precisely because* a round-1 bare column REVOKE once shipped inert. Nothing would fail
   if this migration regressed to the proven-inert form.

### HARD ORDERING CONSTRAINT

> **Apply `20260727000001` BEFORE flipping `AI_READINESS_EXTRACTION=1`.**

Prod has no `ai_signals` data yet (branch unmerged), so the bypass is only exploitable once extraction
starts writing. Merging without applying it ships the paywall hole open the moment the canary flips on.
Both deploy orders are *operationally* safe (every `pages` read in the repo is service-role —
`stream/route.ts:86`, `llms-txt/route.ts:36`, `export/route.ts:43`, `mint-snapshot.ts:48`,
`persist-results.ts`; zero anon/authenticated PostgREST reads, no `select('*')`), but they are **not
equivalent for the paywall**.

Two independent reviewers each ran a **transaction-rollback rehearsal against the live DB** and confirmed:
13/14 columns re-granted, `authenticated`/`anon` `ai_signals` → false, `url` → true, `service_role`
untouched and cannot be locked out. Idempotent across two runs.

---

## 5. Canary limitations (must be in the PR runbook)

**Env flips need a REDEPLOY.** Vercel bakes env vars into a deployment; a dashboard flip does not reach
running functions. Verified first-hand: the Preview keys were set 01:10–01:32 and `/api/audits/start` kept
500-ing until the **01:34 redeploy**. Plan every flip *and* the abort as flip-then-redeploy
(`vercel redeploy --prod`), and confirm the deployed build observes the value before believing the switch
is thrown. (`packages/engine/src/audit-config.ts` and spec amendment v1.2 §1 have both been corrected.)

**What `AI_READINESS_EXTRACTION=0` DOES abort:** all new per-page extraction, the WAF read, the one new
`llms.txt` egress, all new writes to `pages.ai_signals` / `audits.ai_readiness`, and therefore all new AI UI.
Grade byte-identity across the switch is pinned deterministically (`extract.test.ts:173`;
`packages/engine/src/ai-kill-switch.test.ts` OFF-then-ON gives the same grade **and** score), and the
network completeness is pinned by **request-log observation**, not field absence.

**What it does NOT abort — the important part:**
- rendering of **already-persisted** `ai_readiness` / `ai_signals` on `/audit/[id]`;
- **minted `/r/` snapshots** — the field is frozen permanently. Re-mint is impossible
  (`mint/route.ts` short-circuits on `if (existing) return {alreadyPublic:true}`) and minted-snapshot
  immutability is a MUST-NOT-CHANGE rule, so a **scoring** regression discovered post-mint is
  unfixable except by takedown;
- server-side `ai_signals` read amplification (`app/api/audits/[id]/stream/route.ts:81` selects it for
  every viewer on every v2 completed-audit view);
- the Pro/owner **llms.txt generator route** (`app/api/audits/[id]/llms-txt/route.ts`) — entirely outside
  the switch, reads only pre-SPEC-05 columns;
- the 7 new PostHog events on existing audits; the new AI client bundle (ships to every visitor).

**Therefore:**
> The kill-switch aborts **cost/egress** regressions, **not render-path** regressions.
> **Do not mint public reports during the canary window.**
> A render or scoring bug needs a **code revert**, not a flag flip.

**Rollback of the merge is safe** even with AI-bearing minted reports: no zod/`safeParse`/`.strict()` on the
snapshot read path, no exhaustive `Object.keys/entries/values/assign` iteration in `components/report`,
`app/r`, `lib/report-content.ts`, `lib/reports.ts`, `lib/badge-report.ts`;
`REPORT_SNAPSHOT_VERSION` stays 1 and no reader branches on it. Old code ignores the extra key.

---

## 6. Status of the rest of Stage 7 (done, keep)

- **A1–A18: all have named passing tests.** A12 re-probed live this session: `anon` is refused at the
  **GRANT layer** on `audits` (`permission denied for table audits`) and sees **0 rows** on `pages`.
- **A15 backtest: DONE.** `evidence/backtest-spec05-stage7.md` — 30 audits, 28 graded, 2 excluded, 15
  partial. One row breached |Δ|>5 (`stream4k.tv` +6.22) and is **explained, not waved through**: the
  harness diffs engine v1↔v2, SPEC 05 contributes no grading input, and the **v2 column reproduces the
  stored production grade exactly** (75.20 vs stored 75.2) — so the delta is the already-shipped ENGINE_V2
  cutover. Excluding it, the largest |Δ| is 1.95.
- **A19: PARTIAL, by owner ruling.** Free surface + the A11 boundary proven on the deployed preview;
  crawl→render **deferred to a supervised production canary**. Must be stated honestly in the PR — *not*
  unqualified-green. Reason: preview deployments cannot run the worker — the preview's `inngest.send()` is
  consumed by the **production** environment and executed by the **production** deployment (preview app is
  never synced to an Inngest branch env). Verified: preview served `/api/audits/start` ×3 and **zero**
  `/api/webhooks/inngest`, while prod logged 13 stamped `branch=main` at the same timestamps.
  See `[[reference_preview_cannot_start_audits]]`.
- **PR body draft** was written to a session-scoped scratch path and is NOT in the repo; assume it is
  gone and re-derive it from this brief. It contained the A1–A19 table, the corrected canary runbook, and
  a reviewer-notes section explaining two diffs that look wrong at a glance — the XSS assertion changed
  from `not.toContain('onerror=')` to asserting the ESCAPED form (a strengthening: React escapes `<`, so
  the literal substring survives escaping and testing for its absence tests the wrong property), and the
  bot fixture corrected to match the shipped registry (`OAI-SearchBot` retrieval, `GPTBot` **training**) so
  a `blockedRetrievalBots` filtering bug cannot hide behind a mislabelled fixture.
- **FU-5 still OPEN.** `docs/specs/05-follow-ups.md` records a cold-start flake in the fence-integrity
  security assertion, with the owner ruling *"must be RESOLVED or FORMALLY ACCEPTED at the Stage-7 gate"*.
  It did not reproduce (6 full runs + 8 cold probes) and fails closed, but it needs an **explicit
  accept/resolve decision**, not silence.

**Out of scope, found this session, unfixed, owner-notified:** `apps/web/middleware.ts:18-20`
unconditionally stamps `X-Robots-Tag: noindex` on **all** `/r/` (latently defeating SPEC 04's per-report
indexability), and its per-request cookie makes every `/r/` response `no-store`, so `revalidate = 300`
never caches. Both pre-existing on `main`, neither touched by this branch. See
`[[project_middleware_defeats_r_page_design]]`.

---

## 7. Process lessons — apply these on resume

1. **Run each gate reviewer in its OWN worktree.** Both final-gate reviewers were put in the same
   worktree (`../crawlmouse-gate`); they mutation-tested the same files concurrently, so one saw the
   other's mutants and its first suite run failed against a mutant rather than HEAD. It recovered by
   bracketing every result with clean `git status` checks, but the isolation was defeated by the setup.
2. **Gate a FROZEN SHA.** An earlier round was invalidated because the branch moved four commits mid-gate.
   Detach a worktree at a specific SHA and do not commit to the branch while a gate is running.
3. **Clear `node_modules/.vite` between mutation runs.** Copying files in and out leaves stale transformed
   modules; several early "mutation caught" verdicts were cache artifacts and had to be re-run.
4. **Reviewer scratch files must be deleted.** A leftover `apps/web/lib/__scratch_probe*.test.ts` joins the
   vitest glob and fails the suite (it happened twice). Verify `git status` clean after every gate.

---

## 8. THE FAILURE PATTERN TO AVOID

> **Bounding one layer and declaring the class closed.**

Four instances in this gate, each found only after the previous "fix":

| # | Bounded | What was still unbounded |
|---|---|---|
| 1 | `aiReadiness` spread into the mint snapshot | the **client/SSE payload** carried the same raw ledger |
| 2 | client `score.findings` (100) | **`aiPackets`** — 3000 packets, 1.24 MB (found only when writing tests for #1) |
| 3 | `aiPackets` (built from the bounded score) | **`whatAiSees`** — 4.03 MB, 40× larger than either (B4) |
| 4 | top-level snapshot whitelist | **nested objects** copied by reference (one-level whitelist) |

And the same shape in the surrogate fix: the guard went into `apps/web/lib/report-snapshot.ts`, whose
strings are **static templates and percent-encoded URLs** — where the risk isn't — and was omitted from
`buildExcerpt` and `jsonLd.types`, which process **raw crawled prose** — where it is. The instance shown
got fixed; the class was never searched.

**On resume, for every fix: enumerate every site in the class before writing code, and make the test
fixture representative of the WORST case, not a convenient one.** Three separate tests here passed for the
wrong reason because the fixture was too small (2 pages, 2 findings, all-packetable) to exercise the
property they were named for.

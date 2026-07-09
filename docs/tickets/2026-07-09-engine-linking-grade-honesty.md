# Engine ticket — the linking grade reads dishonestly on heavily-orphaned & JS-rendered sites

**Status:** OPEN · logged 2026-07-09 · **scope AFTER SPEC 05 locks** · standalone engine ticket
**Do NOT** fix in `ai/spec-05-readiness`, and do NOT absorb into the SPEC 05 spec — SPEC 05 keeps the A–F
grade byte-identical (non-regression contract §13.1). This is about the **linking grade's own honesty**.

## Symptoms

1. **JS-rendered sites over-credited.** `alynthe.com` scores **A-/88 with "0 orphans"** even though its
   pages are effectively JS-only / unreachable to a non-rendering crawler — a static/AI crawler following
   links from the homepage can't reach them. The grade rewards a site whose content a non-JS crawler can't
   actually traverse.
2. **Heavily-orphaned sites read dishonestly.** `mohammadalinijhoom.com` grades **B-/74 with "Strong
   internal linking — keep it up"** while **~47% of the site is orphaned (130 of 277 pages)**. The grade
   reads clean/strong even though nearly half the pages have no inbound internal links.

## Why this is separate from SPEC 05 (and evidence the honesty design already works)

SPEC 05's **AI/agent-readiness** score is the counter-signal, and it functions correctly: the same
`alynthe.com` scores **40 / at_risk** on AI-readiness. **The two scores disagreeing loudly IS the intended
honesty design** — the AI-readiness score exposes exactly the reachability/JS-blindness the linking grade
currently glosses over. So SPEC 05 needs no change here; the linking grade does.

## Where it lives

Next to the **`jsOnly` reachability signal** SPEC 05 already reasons about — the site-level JS/SPA detector +
its orphan suppression (`packages/engine/src/analysis/js-detect.ts`), the reachability/`jsOnly` derivation in
graph assembly, and the orphan/depth/coverage inputs to `grade.ts`. Any fix must respect the same
non-regression guards (four components/weights, A–F scale, coverage floor) and re-run the backtest.

## Repro

- `https://alynthe.com` — A-/88, "0 orphans", JS-only/unreachable nodes (linking) vs 40/at_risk (AI-readiness).
- `https://mohammadalinijhoom.com` — B-/74, "Strong internal linking — keep it up", while ~47% orphaned
  (130 of 277 pages).

## Disposition

Scoped **after** SPEC 05 locks; owned by the engine, not SPEC 05. Logged per owner ruling 2026-07-09.

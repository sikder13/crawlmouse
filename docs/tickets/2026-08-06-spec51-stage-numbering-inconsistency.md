# SPEC 5.1 — the stage numbers in §9/§10/§11 disagree with §14's plan

**Filed** 2026-08-06 during the Stage 6 acceptance sweep. **Spec hygiene only — do not fix now.**

## What

`docs/specs/05_1-engine-honesty-spec.md` numbers the same three sections two different ways:

| section header | §14 "Terminal 5.1b" plan calls it |
|---|---|
| `## 9. Stage 6 — Honest scoring` | `7. Stage 7 — honest scoring (§9)` |
| `## 10. Stage 7 — Calibration` | `8. Stage 8 — calibration (§10)` |
| `## 11. Stage 8 — Invariants and determinism as property tests` | `9. Stage 9 — invariants (§11)` |

So "Stage 6" names both the 5.1a close-out (§14 item 6) and honest scoring (§9's header), and every
later stage is off by one depending on which part of the document you read.

## Why it matters enough to write down

The **terminal** assignment is unambiguous and unaffected: §14 places §9, §10 and §11 in Terminal 5.1b,
a fresh terminal after 5.1a merges. That is what the acceptance sweep relied on to mark B14 and B15 as
"not 5.1a's to meet" rather than as failures.

The **stage numbers** are not unambiguous, and a 5.1b session starting from a handoff that says
"Stage 7" cannot tell from the spec alone whether that means honest scoring (§9's header) or something
else. This has already produced one piece of drift: the handoff and the acceptance instruction both
said "A1–B17", when §15 has no A-series at all.

## Suggested fix

Renumber the §9/§10/§11 headers to match §14's plan (Stages 7/8/9), since §14 is the controlling
sequence and is referenced by the operating rules' gate procedure. One-line change per header, no
content change. Worth doing at the top of 5.1b rather than mid-5.1a, so it cannot be confused with a
behaviour change on a branch under review.

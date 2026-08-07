# Refusal-gate import-graph guard — six measured evasions, deliberately not closed

**Filed** 2026-08-06 from the SPEC 5.1a Stage 6 adversarial gate (reviewer 3).
**Status** open, low urgency — none of the six is present in the codebase today.

## What the guard catches

`apps/web/__tests__/refusal-gate-import-graph-guard.test.ts` flags a `??`/`||` whose **left operand
names a verdict** and whose right operand is a **literal** — `grade ?? ''`, `asNumber(row.score) ?? 0`,
`score ?? '—'`. That is the shape of all five historical leaks.

## What it does not catch

All six were demonstrated by *writing* them; a repo-wide check confirms none exists today.

| idiom | why it slips |
|---|---|
| `const { grade = 'F' } = row;` | destructuring default — no `??`/`||` |
| `function fmt(grade = 'F')` | parameter default — same |
| `out.grade ??= 'F';` | logical assignment — different operator |
| `row.grade !== null ? row.grade : 'F'` | ternary |
| `grade ?? FALLBACK_GRADE` | right operand is an identifier, not a literal |
| `const g = row.grade; … grade: g ?? '?'` | renamed binding — needs dataflow, not a regex |
| `score:`⏎`  row.score ?? 0` | wrapped expression — the match is line-based |

**The ternary is the one that mattered.** The guard's own header previously called
`x != null ? x : LITERAL` *"SAFE by construction"*. It is not — it fabricates exactly the `'F'` the `??`
form is caught for, so a reviewer following our written advice would have moved a leak from caught to
uncaught. **That wording is now corrected in the file**, and the genuinely safe form is named instead:
an early return on a missing verdict, which produces no fallback value at all.

## Why they are not closed

Closing them was attempted and **made the guard worse, measured**:

| matcher | flagged sites | quality |
|---|---|---|
| anchored (shipped) | 16 | every one a real verdict-adjacent fallback |
| "any fallback on a line mentioning a verdict" | 96 | mostly noise |
| + proximity window (40 chars) | 40 | still included a type declaration, a blank line, Stripe checkout URLs, sparkline geometry |
| + scoped to `apps/web`/`inngest` | 28 | ~18 still unrelated to verdicts |

A 96-entry inventory is ~80 rubber-stamped justifications — **this guard's own failure mode wearing a
new costume**, and precisely what made the SPEC 05 barrel guard vacuous. A precise guard with a
documented gap is worth more than an imprecise guard with an inventory nobody reads.

Precedent: `crawled-text-cut-guard.test.ts` documents its own undetectable case (a manual `charAt`
accumulation loop) the same way — *"logged as FU-8 with the verified evasion rather than shipped as
noise"*.

## If this is revisited

A regex over source text is the wrong instrument for the renamed-binding and wrapped-expression cases.
The right one is a TypeScript AST pass (`ts-morph` or the compiler API): resolve the type of each
fallback's left operand and flag when it is `string | null` / `number | null` originating from an
`AuditRow`. That is a different tool with a different cost, not a tightening of this regex — and it
would subsume all six.

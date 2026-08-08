# FIXTURE-MEDIUM — derive replay rows from real data instead of hand-authoring them

**Filed:** 2026-08-08 · **Source:** SPEC 5.1a delta gate 10 · **Severity:** medium
**Status:** open — **TOP test-infrastructure item for 5.1b** (owner-scheduled, deliberately not rushed)

## The finding this exists for

Four consecutive gates found a surviving evasion in the *fixtures* rather than the code, each one
radius smaller than the last:

| gate | the medium that was too weak | what survived |
|---|---|---|
| 6 | the render decision lived in unmountable JSX | a source guard could not police it |
| 7 | the file was in no test at all | the **props** handed to the decision |
| 8 | fixtures drove a stream of length one | the **stream shape** (a second payload) |
| 9 | fixtures drove one hand-picked row | the **row shape** (`confidence === 'low'`) |
| 10 | fixtures vary the predicted axes | a **row-shape ATTRIBUTE** nobody varied (`page_count`) |

The gate-10 survivor, verified independently:

```tsx
// apps/web/app/audit/[id]/AuditView.tsx — replacing snapshot={snapshot}
snapshot={snapshot && (snapshot.page_count ?? 0) > 4 ? { ...snapshot, crawlHealth: null } : snapshot}
```

```
apps/web:  Test Files 208 passed (208)   Tests 1562 passed (1562)
tsc --noEmit: exit 0        next lint: ✔ No ESLint warnings or errors
```

A refused row renders "Couldn't grade this site" and the pre-5.1 invented cause; a graded v2 row is
demoted to the legacy GradeCard.

**Reachability, measured on production (`ezspnfeyzwsisymytssm`, 2026-08-08):**

| | |
|---|---|
| audits that would refuse | **51** |
| …of those with `page_count > 4` → failure card instead of the Stage 4 arc | **12** |
| v2 completed audits | **206** |
| …of those with `page_count > 4` → lose the v2 arc (gap, free cure, conversion spine) | **167** |

`page_count` is the cheapest member of a family. The same is true of `cms_detected`, `settings.pageCap`,
viewer identity, `link_count`, `estimateSource` (fixtures never use `'sitemap'`) and the trigger set
(fixtures never use `no_observed_links`, which is **36 of the 51** real refusals).

## Why the fix is a medium change, not more axes

**Enumeration cannot terminate.** This is the identical shape of the gate 4–6 failure, where a SQL
source matcher was patched to catch filenames, then naming conventions, then body syntax, and was
evaded each time. What ended that class was not a better matcher — it was **replacing the medium**: a
catalog assertion, which does not care how anything is spelled because it reads what Postgres actually
holds.

Adding `page_count` to the matrix would close one attribute and leave the family. The analogous medium
change for fixtures is to stop authoring row shapes at all.

## The proposal

**Derive the replay rows rather than writing them**, by either route (they compose):

1. **Real production row shapes.** Snapshot a de-identified set of `audits` rows spanning the shapes
   that actually occur — every distinct `(confidence, partial, refusal.triggers, estimateSource)`
   combination present, with real `page_count` / `link_count` — and replay every one through the route
   capture. The corpus is small (212 completed audits) and the distinct-shape count is far smaller.
2. **Property-generate over the payload's declared types.** `ClientAuditV2` and the `audits` row type
   already declare the field domains; `fast-check` is already a repo devDependency and
   `OPERATING-RULES` §10 already requires property tests where the spec says property.

**With ONE invariant asserted across all of them**, which is the thing every one of these evasions has
violated:

> **A refused audit never renders the failure card**, and never renders a letter — whatever else is
> true of the row.

Plus its two siblings: a graded v2 audit always reaches the v2 arc, and no non-`error` surface ever
renders the invented cause. Those hold across the whole generated space, so no single attribute is a
hiding place — which is exactly what the catalog assertion did for SQL.

## Acceptance

- The gate-10 survivor (`page_count`-conditioned) dies without anyone having named `page_count`.
- At least two further attributes chosen at random by the implementer — not from this ticket's list —
  also die when conditioned on.
- The mutation text for each is committed, so the result is re-derivable by someone else
  (`OPERATING-RULES` §10).

## Explicitly NOT a shipped-behaviour defect

The shipped code is correct. Three consecutive full gates found zero shipped-behaviour blockers and
production source has been comment-only since `347e6e8`. This is test-infrastructure debt with a
measured blast radius, scheduled rather than rushed, and the fixture limit is **stated** in
`apps/web/app/audit/[id]/AuditView.test.tsx`'s header rather than left to be discovered.

## Related

- `evidence/2026-08-08-delta-gate10.md` — where the fourth survivor was found and measured.
- `evidence/2026-08-08-gate9-reports.md` — the third (NB-1), and the row-shape matrix that answered it.
- `docs/tickets/2026-08-07-frontier-catalog-guard-uncovered-shapes.md` — the same doctrine for SQL.

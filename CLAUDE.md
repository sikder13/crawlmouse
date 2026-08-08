# Crawlmouse — session bootstrap

> **This file is intentionally UNTRACKED and intentionally thin.** It is a local pointer, not a rules
> document. The operating law lives in one tracked, versioned place so it cannot drift from what
> reviewers and fresh worktrees actually read:
>
> ### → `docs/OPERATING-RULES.md` — the source of truth. Read it first, and follow it.
>
> Do not copy rules here. If a rule needs to change, change it in `docs/OPERATING-RULES.md` and commit
> it; anything written here is invisible to review and to every other checkout.

Load automatically at session start:

@docs/OPERATING-RULES.md
@PROJECT_OVERVIEW.md
@docs/specs/00-crawlmouse-master-build-plan.md

Then read the active phase's spec (one spec in context at a time) before planning.

## Local-only notes (nothing here is a rule)

- `nvm use 22` — the system default is 20, and a stale shell is the usual cause of a confusing failure.
- A fresh worktree has no `apps/web/.env.local` (it is gitignored), so `next build` fails there on
  `/api/billing/checkout`. Copy it in from an existing checkout. See `docs/OPERATING-RULES.md` §7.
- Current phase: SPEC 5.1a — `docs/specs/05_1-engine-honesty-spec.md`.

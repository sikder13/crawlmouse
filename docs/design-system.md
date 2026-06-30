# Crawlmouse Design System

> The trust infrastructure for the product (SPEC 00 D6, SPEC 03 §2). We **elevate the brand
> (cream/orange), we do not rebrand.** The bar is Apple's **"obvious and safe"**: every screen
> should feel like the obvious place things go, calm where it should be calm, dense where a pro
> expects density. The UI is how trust is felt.

## Principles
1. **One source of truth.** All color lives in `apps/web/lib/brand.ts`; `tailwind.config.ts`
   imports it. The two can't drift (enforced by `apps/web/__tests__/design-tokens.test.ts`).
2. **Tokens, not ad-hoc values.** No raw hex or one-off font sizes in page/component code —
   route everything through the tokens below. (Sanctioned exceptions: the satori OG image and
   the embed-badge iframe import `BRAND` raw hex because they can't use Tailwind classes.)
3. **Every interactive element defines every state** — hover / focus-visible / active /
   disabled / loading. **`focus-visible` is non-negotiable** (keyboard a11y; it never fires on
   mouse click, unlike the legacy `focus:`).
4. **Honor reduced motion.** A global `prefers-reduced-motion` guard in `globals.css` softens
   all animation/transition; components add `motion-reduce:*` where they animate.
5. **Never rename existing brand classes** (`cream`, `ink`, `peach`, `sage`, `oat`, `warning`,
   `font-display/sans/mono`) — non-owned surfaces (`/r/[slug]`, OG, embed, blog) depend on them.

## Color tokens
Raw palette (`brand.ts`): `cream #fdfaf5` · `white #ffffff` · `oat #e8e2d4` · `ink #1a1a18` ·
`inkMuted #5c5a52` · `peach #ff7849` · `peachLight #ffd7c2` · `peachText #d8603a` ·
`sage #7a9b7e` · `sageLight #c9d6c5` · `warning #ff5630`.

Semantic roles (use these in new code):

| Role (Tailwind) | Value | Use |
|---|---|---|
| `surface` / `bg-cream` | cream | app background |
| `surface-raised` | white | cards, inputs |
| `text-ink` | ink | primary text |
| `text-ink-muted` | inkMuted | secondary text, labels |
| `accent` / `bg-peach` | peach | brand accent — wordmark, borders, grade ring, focus rings, graph accents |
| `bg-accent-fill` | accentFill `#c84e1e` | **fill** for solid buttons + peach badges (white text, AA 4.60:1) |
| `text-accent-text` | peachText | accent **text** on cream (large/emphasis only — see AA) |
| `positive` / `bg-sage` | sage | positive / passing accent (non-text uses) |
| `bg-sage-fill` | sageFill `#5a7a5e` | **fill** for solid sage/success badges (white text, AA 4.79:1) |
| `bg-warning` | warning | warning accent (non-text: invalid border/ring) |
| `bg-warning-fill` | warningFill `#cf421e` | **fill** for destructive button + warning badge (white text, AA 4.72:1) |
| `locked` | inkMuted | locked/disabled affordances |

## Type scale (`fontSize`)
`display 3.5rem/700` · `h1 2.5rem/700` · `h2 1.875rem/700` · `h3 1.375rem/600` ·
`body-lg 1.125rem` · `body 1rem` · `caption 0.8125rem` · `overline 0.6875rem/600` (tracked).
Families: `font-display` (Fraunces), `font-sans` (Geist), `font-mono` (Geist Mono).

## Spacing · radius · elevation · motion
- **Radius:** `rounded-control` (0.625rem — buttons/inputs) · `rounded-card` (1rem) ·
  `rounded-card-lg` (1.5rem — grade/feature cards) · `rounded-full` (pills).
- **Elevation:** `shadow-surface` < `shadow-raised` < `shadow-overlay` (ink-tinted). Default
  cards are **flat**; `raised`/interactive add elevation.
- **Motion:** keyframes `reveal-up`, `grade-pop`, `shimmer`. All gated by reduced-motion.

## Component inventory (`components/ui/*`)
- **Button** — variants `primary | secondary | ghost | destructive`; sizes `sm | md | lg`;
  `loading` (spinner + `aria-busy`, auto-disabled). hover/active/disabled + focus-visible ring
  on every variant. Fills carry **ink** text (AA).
- **Card** — `default` (flat, backward-compatible) | `raised` | `locked`; sizes `sm | md | lg`;
  `interactive` (hover elevation + focus-visible). `lg` replaces GradeCard's old `!important`.
- **Badge** — grade tones `peach | sage | ink | oat` + status tones
  `success | warning | info | neutral`. Ink text on light fills (AA).
- **Input** — hover, disabled, `focus-visible`, `invalid` (+ `aria-invalid`).
- **GradeCard / GradeCardSkeleton** — unchanged props (public-report safe); `lg` size, tokens,
  AA text, reduced-motion skeleton.

## WCAG AA contrast record (§9)
Measured by `components/ui/contrast.ts` (AA-normal ≥ 4.5, AA-large/UI ≥ 3.0):

| Pair | Ratio | Verdict |
|---|---|---|
| ink / cream | 16.74 | ✅ AA |
| ink-muted / cream | 6.64 | ✅ AA |
| ink / white | 17.43 | ✅ AA |
| ink-muted / white | 6.91 | ✅ AA |
| ink / peach | 6.67 | ✅ AA |
| ink / sage | 5.66 | ✅ AA |
| ink / warning | 5.50 | ✅ AA |
| ink / peachLight | 13.07 | ✅ AA |
| **white / accent-fill** | **4.60** | ✅ AA — darkened orange fill (buttons + peach badges) |
| **white / sage-fill** | **4.79** | ✅ AA — darkened sage fill (sage/success badges) |
| **white / warning-fill** | **4.72** | ✅ AA — darkened warning fill (destructive + warning badge) |
| accent-text / cream | 3.57 | ⚠️ AA-large only |
| accent-text / white | 3.71 | ⚠️ AA-large only |
| **white / peach** | **2.61** | ❌ fails |
| **white / sage** | **3.08** | ❌ fails AA-normal |
| **peach / cream** | **2.51** | ❌ fails (peach is a fill, not text-on-cream) |

**Rules that follow:**
- **Every solid saturated fill carries WHITE text on a darkened `*-fill` token** (all ≥ 4.5:1):
  `accent-fill` #c84e1e (4.60), `sage-fill` #5a7a5e (4.79), `warning-fill` #cf421e (4.72). Used by
  filled buttons (primary, destructive) + the peach/sage/warning badges.
- **The bright base tokens (`peach` #ff7849, `sage`, `warning`) are NON-TEXT accents only** —
  wordmark, borders, grade ring, focus rings, invalid border, graph — never a white-text fill
  (white-on-peach 2.61, white-on-sage 3.08, white-on-warning 3.17 all fail).
- **Light-tint chips (`oat`, `info`/peach-light, `neutral`) keep ink text** — white is invisible on
  a light tint; the one intentional exception to white-on-fill.
- **`accent-text` (#d8603a) is large/emphasis text only** on cream/white (3.5–3.7:1) — never small
  body; body text is `ink` / `ink-muted`.

## Accessibility patterns (SPEC 03 Phase F)

These are enforced by tests, not just convention:

- **Links that look like buttons render as ONE element.** Use `buttonClasses({ variant, size, className })`
  from `components/ui/Button.tsx` on the `<a>`/`<Link>` itself — never wrap a `<Button>` in an `<a>`/`<Link>`
  (nested interactive content = two tab stops + ambiguous activation, WCAG 4.1.2). `<Button>` is for
  controls that *do* something (`onClick`, `type="submit"`). The guard
  `components/no-nested-interactive.test.ts` fails if the wrapping pattern reappears in owned UI.
- **Every interactive control shows a visible keyboard focus ring** (`focus-visible:ring-2` + offset) and
  **yields to `prefers-reduced-motion`** (`motion-reduce:*` on every transition/animation; plus the global
  guard in `globals.css`). Pinned by `components/a11y-smoke.test.tsx`.
- **Inputs have an accessible name** — a `<label>` or `aria-label`; a `placeholder` is *not* a label.
- **The grade reveal announces to screen readers** via an `sr-only` `role="status" aria-live="polite"`
  region (`GradeReveal`); `ActivatingPro` does the same for the post-purchase wait.
- **No `dangerouslySetInnerHTML` on crawled strings** — titles/anchors/URLs/rationale/packet bodies render
  as auto-escaped JSX text (URLs as text, never an href). Verified by the XSS fixtures (U12).
- **i18n-readiness:** copy is inline English (extractable later); dates render client-side via `LocalTime`.
  Full localization is post-v1 — the rule for v1 is "don't bake in assumptions that block extraction."

_Last updated by SPEC 03 Phase F (states + a11y sweep); Phase A established the tokens + contrast record._

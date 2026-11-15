# SPEC 39 — the launch fixes CC-38's walk found

CC-38 walked every customer journey on a production build and found one launch blocker and eleven
defects a customer would see (`walk-findings.md` items 1–13; items 12 and 14 belong to CC-37 and
CC-33). This step fixes those, each with a test that fails when its fix is reverted. It changes
nothing else.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Why                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Cancel works in two clicks.** Settings › Plan reads the cancel route's `?cancel=confirm` and shows the second click where the first was: a form posting `accountId` and `confirm=true` to `/api/billing/cancel`, under a sentence saying what ends and when (a paid plan at its period's end, `renews_at`; a trial with a card at the trial's end; a plan Stripe cancels at once, `past_due`, `unpaid` or `paused`, now). The route and its Stripe call are unchanged. `?cancel=done` is not read: the page shows a cancel once the webhook has written it, never from the address alone. The Billing portal is offered to the owner of any account with a card on file or a subscription. **Ruling 1:** a trial whose subscription is `trialing` (Settings) or renews at its end (the rail, `renews_at`) came through Checkout and holds a card, so neither says "No card on file" or that the account stays on Free, Settings offers its Cancel, and the rail offers no Keep. Tier A. | A paying customer who cannot cancel blocks launch, and a trial told "nothing to cancel" while its card will be charged is the same failure. |
| D2  | **The header knows the session.** The header of a kept audit's result, fix, map and segment pages, and Pricing's for a signed-in viewer, offer the signed-in shell's first rail entry (Sites, `/dashboard`) in place of Log in. A kept audit is read only by a member of its account. The fix page of a kept audit links "Mark it done from Sites" to `/dashboard`, from which the site's page marks it done: the audit pages carry no site id (`app/audit/[id]/_lib/real-data.test.tsx`). Tier B.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | A signed-in owner told to log in thinks the product lost them.                                                                              |
| D3  | **Layout and numbers**: F3, F4, F5, F6, F10, F11, as the brief states them. Tier B.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Each is on a screen a customer or their client sees first.                                                                                  |
| D4  | **Copy.** F7: the delete step says an email change holds it while its confirmation link is live and, once the change applies, for the seven days its undo link works (one sentence; the email form's sentence for the same code is unchanged). F12: the deletion link's page says "account" or "accounts" by the count it names. Tier B.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Wrong cause, wrong wait; a plural for one account.                                                                                          |
| D5  | **F8 is real, and is not fixed here.** See below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Recording the card is a webhook and migration change with its own Tier A review.                                                            |

## Ruling 4: shown prices come from `prices.ts`

The owner decision of 2026-11-03 (D-2026-11-03-2) set Agency at $99 a month ($990 a year) and an
extra seat at $12. Two places a customer sees still said $69. Every shown price now reads
`apps/web/lib/billing/prices.ts`, through `formatPlanPrice(plan, interval)` and `formatExtraPrice(item,
interval)` (`apps/web/lib/v2/copy/plan-price.ts`) or `usd()` on its constants.
`__tests__/v2/shown-prices.test.tsx` holds this. It fails on a typed price in the source, whole dollars,
spaced or with cents, outside the exemptions it names. It fails on any price `prices.ts` does not hold
in the copy modules, the registry's `rendered` and the rendered v2 screens it lists. Where those name a
plan with its price, it fails unless the price is that plan's. In the blog, it fails if Pro's price is
not Pro's. Its header lists what it does not check: the dashboard at its site limit is not rendered, and
its Agency line is held by the source check.

| Where                                                                             | Before                                  | After                                                               |
| --------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------- |
| `components/v2/screens/home/HomeScreen.tsx:35` (Agency card)                      | `'$69'`                                 | `formatPlanPrice('agency')`, $99                                    |
| `components/v2/screens/result/ResultScreen.tsx:306` (Pro panel)                   | "…your own brand, $69 a month."         | `{formatPlanPrice('agency')} a month`, $99                          |
| `HomeScreen.tsx:19,27,31` (Free, Pro)                                             | `'$0'`, `'$19'`, "$19 a month" typed    | `formatPlanPrice('free' \| 'pro')`                                  |
| `lib/v2/copy-registry.ts:97,223`                                                  | (none)                                  | `home` and `result` entries: the artboard's $69 → the decided price |
| `lib/v2/copy/account-door.ts:79`, `agency.ts:150`, `settings.ts:288` (`rendered`) | `'$99 a month'` etc., typed             | `formatPlanPrice('agency')`                                         |
| `lib/v2/copy/pricing.ts:36` (Agency Plus)                                         | `fromMonthly: 249`                      | `AGENCY_PLUS_FROM_MONTHLY` in `prices.ts:22`, same $249             |
| `components/billing/UpgradeLink.tsx:14`, `lib/seo/faq.ts:17`                      | "$19" typed                             | `usd(PRO_MONTHLY)`                                                  |
| `lib/v2/view/dashboard.ts:1046` (the at-limit Agency line)                        | `$${AGENCY_MONTHLY}`, formatted by hand | `formatPlanPrice('agency')`                                         |
| `lib/v2/copy/seats.ts:177` (`rendered`)                                           | `usd(EXTRA_SEAT)`                       | `formatExtraPrice('seat')`                                          |
| `lib/entitlement-spec.ts:111` (the gates table's label)                           | "$12 seats" typed                       | `usd(EXTRA_SEAT)`                                                   |

The five copy-module lines the ruling named at `account-door.ts:77`, `agency.ts:148`, `dashboard.ts:465`,
`settings.ts:271` (now `:286`) and `seats.ts:175` are `locked:` entries: the artboard's text as drawn,
which the lock comparison replaces with the entry's `rendered`. No screen shows them. Their `rendered`
values said $99, or read `usd(EXTRA_SEAT)` for the seat ($12). They now read `prices.ts` where they
were typed.

Left as they are, and named in the sweep, which checks that every price they type is one `prices.ts`
holds (Pro's $19 and $190):

- `app/pricing/page.tsx`, pinned byte-identical to main by `__tests__/v2/public-pages.test.tsx`;
  `/pricing` is the v2 page while `V2_BILLING` is on;
- `components/billing/PricingCards.tsx`, which only that v1 page renders;
- `app/terms/page.tsx`. Neither of these two files was ever formatted, so any edit reflows the whole
  file under CI's Prettier check, and in the Terms that would mean the legal text;
- `lib/blog/content/screaming-frog-alternative.tsx`, which gives Pro's price twice ("Pro $19/mo",
  "Pro at $19/month"): never formatted either, and a published article. The blog check holds that
  price to Pro's.

The screenshots that move (Home's Agency card, and the Result's Pro panel on an audit nobody keeps)
are re-drawn by the PR's visual shards and accepted there; there is no separate dispatch.

## Not fixed here

**F8, the card's last four digits.** Nothing writes `accounts.card_last4`. No TypeScript writes it
(`grep -rn card_last4 apps/web/lib apps/web/app inngest` finds only readers), and the migrations hold
only the column and its grant (`grep -n card_last4 infra/supabase/migrations/*.sql`). Every Checkout
trial collects a card (`apps/web/lib/billing/checkout-v2.ts`, `payment_method_collection: 'always'`),
so every screen that names the card by its last four digits shows none. D1's ruling-1 change keeps
the money sentences true without the digits. The recorder needs a Stripe read of the payment method
at processing time, a write to the account, and handling for a card changed in the portal.
Residual until it lands: a Checkout trial already set to cancel, with no recorded card, reads
"No card on file" on the rail. Its "stays on Free" is then true.

**The portal for an account Stripe knows but the page cannot tell.** The page offers the portal for
a card on file or a subscription; it does not read `stripe_customer_id`. An account whose
subscription has ended and whose card was never recorded (F8) gets no portal and reads "there has
been no charge yet", which is false once it has paid.

**Keep on a Checkout trial set to cancel.** The rail offers Keep for a trial that does not charge its
card, and a trial set to cancel does not; its checkout answers 409 `subscription_open` while the
subscription is open.

**Log in on a kept audit's other states.** The waiting, failed, refused and expired pages
(`ResultStates.tsx`) and the crawl page (`CrawlScreen.tsx`) still offer Log in to a member.

**A signed-in reader on an audit nobody keeps** still sees Log in: the audit pages hand the screens
the check, not the session.

## Verify

```bash
pnpm --filter @crawlmouse/web exec vitest run lib/v2/view/site.test.ts lib/v2/view/reports.test.ts lib/v2/reports/share-gone.test.ts __tests__/v2/result-fixes-fit.test.tsx __tests__/v2/fix-exact-check-wrap.test.tsx __tests__/v2/site-settings-fit.test.tsx __tests__/v2/screens.test.tsx lib/v2/view/settings-cancel.test.ts "app/(account)/settings/plan/" lib/v2/view/account-shell-card.test.ts __tests__/v2/signed-in-header.test.tsx __tests__/v2/launch-copy.test.tsx
```

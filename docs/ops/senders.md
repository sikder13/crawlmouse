# Senders — what the owner sets at switch-on (CC-28 D10)

Prepared in CC-28, applied by the owner when `V2_CHECKS_PUBLIC` is switched on. Nothing here calls
the Supabase or Resend management APIs from code or CI: each step below is the owner's, in a
dashboard or from the owner's own machine (owner ruling Q5).

## 1. Who sends what

| Mail                                                                                                                                            | From                                     | Through                                   | Set where                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| Sign-in and sign-up links                                                                                                                       | `SIGNIN_SENDER`, `magic@crawlmouse.com`  | Supabase Auth, over Resend SMTP           | Supabase Auth `smtp_admin_email` (`scripts/configure-supabase-smtp.sh`)  |
| The product's own mail: alerts, the weekly summary, check notes, a fix sent to a developer, the trial reminder, email-change and deletion links | `ALERTS_SENDER`, `alerts@crawlmouse.com` | Resend's API (`lib/v2/mail/transport.ts`) | `MAIL_FROM` in `apps/web/lib/v2/mail/headers.ts`, read from the constant |

Both constants: `grep -n "SENDER" apps/web/lib/auth/constants.ts`.

## 2. Resend

1. **Domain.** Resend → Domains → `crawlmouse.com` shows _Verified_ (it already sends `magic@` over
   SMTP). Resend sends from any local part of a verified domain, so `alerts@` needs no setting of its
   own.
2. **Webhook.** Resend → Webhooks → an endpoint at `https://crawlmouse.com/api/webhooks/resend` with
   the events `email.bounced` and `email.complained` at least (a hard bounce or a complaint suppresses
   all but account mail to that address, D7). Its signing secret is `RESEND_WEBHOOK_SECRET` (§4). An
   event about mail from `alerts@` is not stored in v1's `email_events` (spec 28, "The send ledger"),
   whichever events are subscribed.
3. **API key.** `RESEND_API_KEY`, already set in Vercel for v1. With it unset the mailer claims nothing
   and logs `mail.unconfigured` (spec 28, "The send ledger").
4. **Replies to `alerts@` (Cloudflare Email Routing, owner action, not applied).** The product's mail
   carries no `Reply-To` (`buildOutgoing` in `apps/web/lib/v2/mail/headers.ts` refuses any header outside `EXTRA_HEADERS`), so a reply
   goes to `alerts@crawlmouse.com`. Cloudflare Email Routing receives for the zone, and
   `scripts/configure-cloudflare.sh` creates no rule for `alerts@`:
   `grep -n "FORWARDED_PREFIXES=" scripts/configure-cloudflare.sh`. Without a rule, a reply to an alert,
   a summary, a check note or an account email bounces. Before switch-on, add one of:
   - Cloudflare → `crawlmouse.com` → Email → Email Routing → Routing rules → _Create address_
     `alerts@crawlmouse.com`, action _Send to an email_, destination the verified inbox the other
     addresses forward to; or
   - `"alerts"` appended to `FORWARDED_PREFIXES` in `scripts/configure-cloudflare.sh`, then the script
     run with the owner's `CLOUDFLARE_API_TOKEN` (it adds only the rules missing).

   Check it took: send a mail to `alerts@crawlmouse.com` from any outside address and see it arrive.

## 3. Supabase Auth (sign-in sender)

Nothing changes at switch-on unless the owner also moves the sign-in sender to `signin@` (§5). The
templates in `infra/supabase/email-templates/` name no sender: the address is Supabase's SMTP
setting alone (`pnpm test:templates` checks the templates for it).

## 4. Variables (Vercel, Production; mark each Sensitive)

| Variable                | What it is                                                                                                         | When unset                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `EMAIL_LINK_SECRET`     | New. Signs unsubscribe tokens (Q6). At least 32 characters: `openssl rand -base64 48`.                             | Alert and summary mail is not sent, and the miss is logged (`linkSecret`, `lib/v2/mail/unsubscribe-token.ts`). |
| `RESEND_WEBHOOK_SECRET` | The webhook's signing secret, from Resend → Webhooks (§2).                                                         | The webhook answers 500 and records nothing (`app/api/webhooks/resend/route.ts`).                              |
| `TRIAL_LEDGER_PEPPER`   | Already set (the trial ledger). The mailer hashes addresses with it, and the erasure finds mail rows by that hash. | The mailer sends nothing; an erasure refuses (`mail_pepper`).                                                  |

A variable read at build time must be listed in `turbo.json` `build.env`:
`grep -n "EMAIL_LINK_SECRET\|RESEND_WEBHOOK_SECRET\|TRIAL_LEDGER_PEPPER" turbo.json`. Vercel applies a
changed variable to the next deployment, not to a running one: redeploy after setting them.

`scripts/ops/erase-account.ts` needs `TRIAL_LEDGER_PEPPER` in the operator's environment too; without
it the dry run prints the `mail_pepper` refusal.

## 5. Moving the sign-in sender to `signin@` (prepared, not applied)

The locked screens name `signin@crawlmouse.com` (`SIGNIN_SENDER_LOCKED`). The pages, Settings and the
copy registry read `SIGNIN_SENDER`, so the move is the owner's two settings and one line of code:

1. **Supabase.** Dashboard → Authentication → Emails → SMTP Settings → _Sender email_
   `signin@crawlmouse.com` (sender name unchanged, `Crawlmouse`). Or edit `smtp_admin_email` in
   `scripts/configure-supabase-smtp.sh` and run it with the owner's `SUPABASE_ACCESS_TOKEN`.
2. **Replies (optional).** Cloudflare Email Routing receives for the zone; to keep a reply to
   `signin@` from bouncing, add a route for it as `scripts/configure-cloudflare.sh` does for `magic@`.
3. **The code, one line**, in a pull request merged after step 1 is saved:

   ```ts
   // apps/web/lib/auth/constants.ts
   export const SIGNIN_SENDER: string = 'signin@crawlmouse.com';
   ```

   Then regenerate the specs that print it:
   `pnpm --filter @crawlmouse/web exec tsx __tests__/v2/generate-spec.ts`. The copy registry's three
   corrections of the locked `signin@` drop out by themselves once the two are equal
   (`pnpm --filter @crawlmouse/web exec vitest run lib/v2/copy/senders.test.ts`).

Order matters: if the constant changes first, the pages name `signin@` while Supabase still sends
from `magic@`.

# Supabase Auth email templates [runbook]

Branded HTML for the two transactional auth emails Crawlmouse sends:

| File | Supabase template | Sign-in link type |
| --- | --- | --- |
| `magic-link.html` | **Magic Link** | `token_hash` + `type=magiclink` |
| `signup.html` | **Confirm signup** | `token_hash` + `type=signup` |

These are applied **manually in the Supabase dashboard** at deploy time. There is
**no database migration** — the dir is a plain folder (`infra/` is not a pnpm
workspace package).

## Why these exist — deploy-gate WARNING

> **The DEFAULT Supabase templates use `{{ .ConfirmationURL }}`, which emits a
> PKCE `?code=` link. That code can only be exchanged on the device/browser that
> requested it, so cross-device sign-in is BROKEN until you replace the default
> templates with the ones here.**

These templates instead point at the app's own callback with a `token_hash`,
which carries no PKCE verifier and therefore works even when the link is opened
on a different device than the one that requested it. Replacing the default
templates is a **required deploy gate**.

## The link contract (keep in lock-step)

The sign-in callback is `apps/web/app/login/verify/route.ts`. It calls
`verifyOtp({ token_hash, type })` with this allow-list:

```ts
const ALLOWED_OTP_TYPES = new Set(['magiclink', 'signup', 'email']);
```

A `type` outside the set is coerced to `magiclink`. So the templates **must**
use exactly:

- `magic-link.html`: `{{ .SiteURL }}/login/verify?token_hash={{ .TokenHash }}&type=magiclink`
- `signup.html`: `{{ .SiteURL }}/login/verify?token_hash={{ .TokenHash }}&type=signup`

Neither file may contain `{{ .ConfirmationURL }}`.

If you ever change the verify route's allow-list, change these templates in the
same commit. The determinism test (`templates.test.ts`) fails if the link
strings drift or a `{{ .ConfirmationURL }}` / `<style>` block creeps in — it is
the guard for this contract.

## Apply in the dashboard (manual, per environment)

1. Supabase Dashboard → **Authentication → Email Templates**.
2. Select **Magic Link** → paste the **raw HTML** of `magic-link.html` into the
   message body (replace the entire default body). Save.
3. Select **Confirm signup** → paste the **raw HTML** of `signup.html`. Save.
4. Supabase Dashboard → **Authentication → URL Configuration → Redirect URLs**:
   ensure the list allows `{{ .SiteURL }}/login/verify` (the full site URL plus
   the `/login/verify` path). If it isn't allowed, Supabase rejects the callback
   and sign-in fails.

Paste the HTML exactly as-is. Do not let the dashboard editor reformat or strip
the inline styles. Re-apply these steps for every environment (staging, prod)
since email templates are per-project, not migrated.

## HTML constraints (don't break these)

- **Inline CSS only.** No `<style>` blocks — email clients strip them.
- No external images, no tracking pixels, no inline SVG (Gmail/Outlook strip
  inline SVG). The wordmark uses a Unicode glyph plus styled text.
- Table-based, centered, ~480px layout for broad client compatibility.

## Test

The determinism test asserts the exact link strings, the absence of
`{{ .ConfirmationURL }}`, and the absence of `<style>` blocks. From the repo
root:

```
pnpm test:templates
```

This runs `vitest` (which lives under `apps/web`) against
`vitest.config.ts` in this directory. The config exports a plain object (no
`vitest/config` import) so it loads even though `infra/` has no `node_modules`.
Expect a green run with all assertions passing.

## Support address

These templates reference `support@crawlmouse.com`. You don't need a paid mailbox:
`scripts/configure-cloudflare.sh` provisions it via **Cloudflare Email Routing**,
forwarding `support@` (alongside `magic@` and `hello@`) to `nahlai.tech@gmail.com`
for free. Run that script, then click the Cloudflare verification email that lands
in that inbox to activate forwarding.

Email Routing is **receive-only** — it forwards inbound mail but does not send. The
auth emails themselves are *sent* from `magic@crawlmouse.com` via Resend SMTP (see
`scripts/configure-supabase-smtp.sh`). To make your *replies* come from
`support@crawlmouse.com`, add a Gmail "Send mail as" alias using Resend SMTP
(`smtp.resend.com:587`, user `resend`, pass = `RESEND_API_KEY`) — optional polish.

If you'd rather not run a custom-domain inbox, change the address in both HTML files.

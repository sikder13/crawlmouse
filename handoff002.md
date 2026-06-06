# Crawlmouse — Project Handoff 002

**Date:** 2026-05-31 (late evening — late afternoon to past midnight session)
**Working directory:** `/home/udsik/nahl-clients-projects/crawlmouse-v1.0.0`
**User:** Udaay Sikder (`ud.sikder@gmail.com` personal; `nahlai.tech@gmail.com` is the **business-Gmail used for all Nahl Tech SaaS signups**)
**Repo:** https://github.com/sikder13/crawlmouse (private, all work on `main`)
**Previous handoff:** `handoff001.md` (deleted after consumption — was at Stripe Step 4)

---

## 0. RESUME PROMPT (what you should do FIRST in the new session)

Open the new Claude Code session in this directory and say:

> "Read `/home/udsik/nahl-clients-projects/crawlmouse-v1.0.0/handoff002.md` and continue from Section 4. Use the Cloudflare MCPs (already authenticated) to finish Turnstile + Email Routing setup. The Cloudflare API token in `scripts/.env.local` is a fallback if MCP doesn't surface tools."

Then read this entire file before doing anything else.

---

## 1. The end goal (unchanged from handoff001)

Build **Crawlmouse** — a viral, free, CMS-agnostic internal-linking SEO grader. Free tier with paywall on CSV export + AI suggestions + scheduled re-crawls. Hybrid strategy:

- **v1.0** — viral consumer web app (current target — ~2 weeks away from launchable state)
- **v1.1** — AI suggestions + scheduled re-crawl + Agency tier (~3-4 weeks post-v1.0)
- **v1.2 / Q3 2026** — developer surface: CLI + GitHub Action + agentic webhooks on the **same** engine

**Four unique wedges** (differentiate from Linkbot / Link Whisper / LinkBoss / HubSpot Website Grader):
1. Letter grade as share asset (HubSpot Website Grader pattern applied to internal linking)
2. Living link graph (Sigma.js, brand-designed, screenshot-shareable)
3. Peer benchmarking + CMS-aware intelligence
4. "Powered by Crawlmouse" embed badge (Calendly / ClickFunnels viral pattern)

---

## 2. Everything completed since handoff001 (chronological)

### Stripe pre-build env setup — COMPLETE ✅
- All 5 Stripe env vars in `apps/web/.env.local`:
  - `STRIPE_SECRET_KEY=sk_test_51TG...` (Test mode, parent account `acct_1TGtSdJp0NUyqKK7`)
  - `STRIPE_WEBHOOK_SECRET=whsec_e0d7f0...` (from `stripe listen --print-secret`; LEAKED in transcript on 2026-05-30 — low risk dev secret, can be rotated via `stripe logout && stripe login`)
  - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_51TG...`
  - `STRIPE_PRICE_ID_PRO_MONTHLY=price_1TbEN0Jp0NUyqKK7mJUiTYTd` ($19/mo)
  - `STRIPE_PRICE_ID_PRO_YEARLY=price_1TcpJUJp0NUyqKK72qlMlLye` ($190/yr)
- Stripe CLI v1.42.1 installed via apt
- CLI paired with `acct_1TGtSdJp0NUyqKK7` (parent "Nahl Technologies Inc" — NOT the empty `acct_1TGtSoJ56oX617DA` sandbox child)
- Verified: `stripe products list` shows `prod_UaPBulrZLWdMzG` "Crawlmouse Pro"

### Resend setup — COMPLETE ✅
- Account created with `nahlai.tech@gmail.com`
- `crawlmouse.com` domain added in region us-east-1
- All 4 DNS records added at Namecheap then migrated to Cloudflare:
  - DKIM `resend._domainkey` → `p=MIGfMA0GCSqGSIb3...wIDAQAB`
  - SPF MX `send` → `feedback-smtp.us-east-1.amazonses.com` priority 10
  - SPF TXT `send` → `v=spf1 include:amazonses.com ~all`
  - DMARC `_dmarc` → `v=DMARC1; p=none;`
- Domain status: **Verified** in Resend
- API key created: `re_cT...` written to `apps/web/.env.local` as `RESEND_API_KEY`
- **Sender:** `magic@crawlmouse.com` (chosen for "UX must not be boring" — playful, on-brand)

### Supabase Auth → Resend SMTP — COMPLETE ✅
- Configured via `scripts/configure-supabase-smtp.sh` (idempotent, can rerun)
- Uses `scripts/.env.local`'s `SUPABASE_ACCESS_TOKEN` (PAT) + `apps/web/.env.local`'s `RESEND_API_KEY`
- SMTP settings applied to project `ezspnfeyzwsisymytssm`:
  - `smtp_admin_email` = `magic@crawlmouse.com`
  - `smtp_host` = `smtp.resend.com`
  - `smtp_port` = 587
  - `smtp_user` = `resend`
  - `smtp_sender_name` = `Crawlmouse`
  - `smtp_max_frequency` = 60
- **Tested end-to-end:** magic-link emails arrive in `nahlai.tech@gmail.com` from `Crawlmouse <magic@crawlmouse.com>` — confirmed working
- ⚠️ Email templates are still Supabase defaults (generic). Custom branded templates are deferred to **Plan 5** Launch Readiness

### Cloudflare account + DNS migration — COMPLETE ✅
- Account created with `nahlai.tech@gmail.com`
- `crawlmouse.com` added as a site (Free plan)
- **Major struggle resolved:** Original Cloudflare nameservers `kane.ns.cloudflare.com` and `xochitl.ns.cloudflare.com` were not in public DNS (verified via `dig` against 1.1.1.1, 8.8.8.8, 9.9.9.9). After deleting + re-adding the site, Cloudflare assigned **`hans.ns.cloudflare.com`** and **`kim.ns.cloudflare.com`** — both resolve correctly
- Also resolved: Namecheap PremiumDNS was active, had to disable it (and Auto-renew) before nameserver change would save
- DNS migration verified: `dig +short NS crawlmouse.com` returns the Cloudflare nameservers
- All 4 Resend records still serving correctly via Cloudflare DNS — no email delivery interruption
- Cloudflare zone status: **Active** ✅
- Cloudflare MCPs all authenticated in current session:
  - ✅ `plugin:cloudflare:cloudflare-bindings`
  - ✅ `plugin:cloudflare:cloudflare-observability`
  - ✅ `plugin:cloudflare:cloudflare-api` ← **THE ONE that exposes zones/Turnstile/email-routing API access**
  - ✅ `plugin:cloudflare:cloudflare-builds`

### Cleanup/decision: deferred earlier "Path Y" pivot — UNDONE ✅
- Initially planned to skip Cloudflare DNS migration entirely and use ImprovMX. After getting the new working nameservers (hans + kim), DNS migration succeeded, so we reverted to the original plan: full Cloudflare stack (Turnstile + Email Routing) instead of ImprovMX.
- ImprovMX is NOT being used. Don't set it up. The corresponding task #10 was deleted.
- The deferred-CDN/migration task #8 was deleted because the migration is now complete.

---

## 3. Current state of `apps/web/.env.local` (line-by-line, values masked)

```
# Lines may shift; use grep to find current line numbers
SUPABASE_URL=https://ezspnfeyzwsisymytssm.supabase.co
SUPABASE_ANON_KEY=eyJh...
SUPABASE_SERVICE_ROLE_KEY=eyJh...   (rotated post-leak per handoff001)
NEXT_PUBLIC_SUPABASE_URL=https://ezspnfeyzwsisymytssm.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJh...
SUPABASE_DB_URL=postgresql://...
RESEND_API_KEY=re_cT...                                ✅ SET
TURNSTILE_SECRET_KEY=                                  ❌ EMPTY — fill in §4
NEXT_PUBLIC_TURNSTILE_SITE_KEY=                        ❌ EMPTY — fill in §4
INNGEST_EVENT_KEY=                                     ❌ EMPTY — fill in §5
INNGEST_SIGNING_KEY=                                   ❌ EMPTY — fill in §5
POSTHOG_KEY=                                           ❌ EMPTY — fill in §5
NEXT_PUBLIC_POSTHOG_KEY=                               ❌ EMPTY — fill in §5
NEXT_PUBLIC_POSTHOG_HOST=                              ❌ EMPTY — fill in §5
SENTRY_DSN=                                            ❌ EMPTY — fill in §5
STRIPE_SECRET_KEY=sk_test_51TG...                      ✅ SET
STRIPE_WEBHOOK_SECRET=whsec_e0d7f0...                  ✅ SET
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_51TG...     ✅ SET
STRIPE_PRICE_ID_PRO_MONTHLY=price_1TbEN0...            ✅ SET
STRIPE_PRICE_ID_PRO_YEARLY=price_1TcpJU...             ✅ SET
```

Current state of `scripts/.env.local` (admin tokens for scripts, gitignored):
```
SUPABASE_ACCESS_TOKEN=sbp_4d7402...      ✅ SET (PAT for Management API)
CLOUDFLARE_API_TOKEN=                    ❌ EMPTY — user needs to generate ONLY if using script path (MCP path skips this)
```

---

## 4. IMMEDIATELY NEXT: Cloudflare Turnstile + Email Routing

**Two paths:**

### Path A (preferred — use MCP, since this is the whole reason for the session restart)
1. In the new session, confirm `mcp__plugin_cloudflare_*` tools are loaded — use `ToolSearch` with query `"cloudflare zone turnstile"` or similar
2. If tools surface, use them to:
   - List zones to confirm `crawlmouse.com` zone_id + account_id
   - Create Turnstile widget: name=`Crawlmouse`, mode=`managed`, domains=`["crawlmouse.com", "localhost"]` → capture `sitekey` + `secret`
   - Write `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` to `apps/web/.env.local` (use `sed` to avoid stray spaces — see precedent in earlier sessions)
   - Enable Email Routing on the zone
   - Add `nahlai.tech@gmail.com` as destination address (triggers Cloudflare verification email)
   - Create 3 forwarding rules: `magic@`, `hello@`, `support@` → `nahlai.tech@gmail.com`
3. Tell user to check Gmail for Cloudflare verification email and click the link to activate forwarding
4. Test: send email to `magic@crawlmouse.com` from another address → confirm arrival in Gmail

### Path B (fallback — script if MCP still doesn't surface tools)
1. User generates a Cloudflare API token at https://dash.cloudflare.com/profile/api-tokens with permissions:
   - Account → Turnstile: Edit
   - Account → Email Routing Addresses: Edit
   - Zone → Email Routing Rules: Edit
   - Zone → Zone: Read
   - Scope: all accounts (or Nahl), zone `crawlmouse.com`
2. User pastes token into `scripts/.env.local` as `CLOUDFLARE_API_TOKEN=...`
3. Run `./scripts/configure-cloudflare.sh` (already written, idempotent, ~8KB)
4. Script handles everything in Path A automatically and prints status

---

## 5. After Cloudflare is done — remaining Phase A setups

Pending tasks (from current TaskList):
- **Task #5** — Set up Inngest cloud account + signing/event keys
- **Task #6** — Set up PostHog project + project API key
- **Task #7** — Set up Sentry project + DSN

For each:
1. Sign up at the service with `nahlai.tech@gmail.com` (per the `[[saas-account-email]]` feedback memory)
2. Create the project named `Crawlmouse` or similar
3. Copy the keys into `apps/web/.env.local` (env var names already present and blank — see §3)

All three have generous free tiers. **Per the 18% MRR cost-ceiling rule (see [[project-cost-controls-18pct]] memory):**
- Inngest: 5-step concurrency limit on Free → upgrade to Pro $75/mo only when traffic forces it
- PostHog: stays free at 1M events/mo; set per-product billing caps to 2x free tier
- Sentry: Free 5K errors/mo + 1 user seat — upgrade to Team $26/mo when adding 2nd teammate

---

## 6. Final goal — full roadmap to v1.0 launch

### Phase A: Pre-build env setup (CURRENT — ~95% done after Cloudflare)
- [x] Supabase account + project + all 9 migrations + RLS hardening
- [x] Stripe account + product + monthly + yearly prices + all keys in `.env.local`
- [x] Stripe CLI installed + paired
- [x] Resend account + domain DKIM/SPF/DMARC + API key + Supabase SMTP wired
- [x] Cloudflare account + DNS migration to Cloudflare (zone Active)
- [ ] **Cloudflare Turnstile keys** ← §4
- [ ] **Cloudflare Email Routing** ← §4
- [ ] **Inngest** ← §5
- [ ] **PostHog** ← §5
- [ ] **Sentry** ← §5

### Phase B: Plan 4 — Billing + Pro features (~1 week)
Use `superpowers:brainstorming` first since several design decisions are open:
- Stripe Checkout redirect vs embedded Stripe Elements
- Trial offer (7-day? 14-day? none?)
- Pricing-page CTA pattern + visual treatment
- CSV export shape + gating UX
- Daily reconciliation cron design (Inngest scheduled function)

Then use `superpowers:writing-plans` to draft `docs/superpowers/plans/2026-XX-XX-crawlmouse-v1.0-plan-4-billing.md`. Plan 4 MUST include cost controls #3/#4/#5/#7 (see [[project-cost-controls-18pct]] memory):
- 30-day TTL on free-tier audits (item #3)
- Email digest mode for free users (item #4)
- Concurrency gating: sequential pages free, concurrent pages Pro (item #5)
- `email_events` table + Resend webhook handler + bounce-aware send logic (item #7)

Plan 4 scope from spec §1.6 + §2.10:
- Stripe Checkout integration
- Customer Portal integration
- `/api/webhooks/stripe` handler (signature verify, handle subscription + payment events, update `users.pro_until`)
- Daily reconciliation cron (Inngest)
- `stripe_events` idempotency (table exists from Plan 2)
- CSV export (Pro-gated)
- Pro-tier middleware on `users.pro_until > now()`
- Upgrade UI on `/pricing`

### Phase C: Plan 5 — Launch readiness (~0.5–1 week)
- Hook up Turnstile (env vars from Phase A end)
- Hook up PostHog + Sentry (env vars from Phase A end)
- Real legal content for `/privacy`, `/terms`, `/aup`
- `/developers` pre-announce landing for v1.2 dev tool (email capture)
- Real load test (k6 — 1000 concurrent audits)
- Custom branded email templates in Supabase Auth (Confirm signup, Magic link, Invite, Password recovery, Email change) — per "UX must not be boring"
- Set hard billing caps in EVERY dashboard (Vercel $100/mo, Supabase $75/mo, Resend pause at 200K, Inngest $150/mo, PostHog per-product 2x free)
- Pre-launch checklist from spec §19.2
- Final E2E smoke against Vercel preview

### Phase D: Production deploy
- Push to Vercel from `main` (auto-deploys)
- **Upgrade Vercel to Pro $20/mo before public launch** (Hobby forbids commercial use)
- Set production env vars in Vercel dashboard (Stripe LIVE keys, not test)
- Point `crawlmouse.com` DNS at Vercel — now via Cloudflare DNS (A/AAAA or CNAME)
- Verify Resend domain ownership (already done via DNS, should still validate)
- Register PROD webhook endpoint in Stripe Live mode
- Switch Stripe to Live mode + complete business profile activation
  - ⚠️ Verify "Nahl Techhnologies Inc" typo (double 'h') in statement descriptor — flagged in handoff001
  - Add co-founder access via Stripe Settings → Team

### Phase E: Launch + post-launch ops
- Marketing: illustrator brief for mascot (still pending Task #8 from original brainstorm), `/top/[platform]` SEO push
- Hard launch sequence: r/shopify → Shopify community forum → Indie Hackers → Product Hunt → HN → Twitter
- Monitoring: PostHog funnel + Sentry errors + Inngest metrics + Stripe MRR
- Customer support: confirm `magic@`/`hello@`/`support@crawlmouse.com` forwarding works end-to-end

### Phase F: v1.1 features (~3–4 weeks post-v1.0)
Highest value first (per spec):
- AI link suggestions (Anthropic Haiku 4.5 + OpenAI `text-embedding-3-small` on pgvector) — ~$0.33/Pro audit
- Scheduled weekly re-crawl with email diff
- Agency tier ($99/mo, 25 client sites, white-label PDF)
- Live LinkGraph node-streaming via Supabase Realtime
- Side-by-side compare view at `/compare`
- Embed view-count atomic RPC
- Benchmark cohort aggregation nightly cron
- Weekly newsletter from aggregate data
- Component-level unit tests for audit UI
- Custom inbound email DB capture (replace simple Cloudflare Routing forwarding with structured `inbound_emails` table)

### Phase G: v1.2 / Q3 2026 — Dev tool surface
- CLI (`npx crawlmouse audit https://...`)
- GitHub Action (CI-blocking grade thresholds)
- Staging-URL crawls with basic auth + custom headers
- Outbound webhooks (Slack/Discord, HMAC-signed)
- Multi-site tracking (5 projects)
- Agentic continuous monitoring (the differentiated "for developers" sale)
- Developer $49 + Team $199 pricing tiers
- Inngest worker as separate service (scalability)

---

## 7. Key references for new session

### Memory (auto-loaded from `~/.claude/projects/-home-udsik-nahl-clients-projects-crawlmouse-v1-0-0/memory/MEMORY.md`)
- `project_product_name.md` — product is Crawlmouse (not LinkSitemap)
- `feedback_ux_not_boring.md` — distinctive/playful UI; burden of proof on boring
- `feedback_research_depth_and_cms_agnostic.md` — fresh web research with sources for every significant decision
- `project_strategic_direction.md` — Hybrid v1.0 viral / v1.2 dev tool
- `feedback_never_mention_ai_tools_in_commits.md` — no Claude/Cursor refs in commits/PRs/comments
- `project_build_state_v1.md` — current build state (UPDATED this session)
- `project_cost_controls_18pct.md` — 18% MRR ops-cost ceiling + 7 cost controls
- `feedback_saas_account_email.md` — use `nahlai.tech@gmail.com` for ALL Nahl Tech SaaS signups

### Spec + plans
- Spec: `docs/superpowers/specs/2026-05-24-crawlmouse-v1.0-design.md` (21 sections, locked decisions)
- Plans 1–3 (completed): `docs/superpowers/plans/2026-05-24-crawlmouse-v1.0-plan-{1,2,3}-*.md`
- Execution logs: `~/.claude/projects/-home-udsik-nahl-clients-projects-crawlmouse-v1-0-0/work-log/plan-{1,2,3}-execution-log.md`

### Scripts
- `scripts/configure-supabase-smtp.sh` — SMTP config (Supabase Management API), idempotent, was used to wire Resend
- `scripts/configure-cloudflare.sh` — Cloudflare config (Turnstile + Email Routing), idempotent, ready to use as Path B fallback
- `scripts/.env.local` — admin tokens (PAT + CF token), gitignored, EXAMPLE template at `scripts/.env.local.example`

### Key external IDs
- GitHub: https://github.com/sikder13/crawlmouse (private)
- Supabase project: `ezspnfeyzwsisymytssm` (org "Nahl Technologies Products")
- Stripe parent account: `acct_1TGtSdJp0NUyqKK7` (Test mode — where work lives)
- Stripe product: `prod_UaPBulrZLWdMzG` (Crawlmouse Pro)
- Stripe prices: monthly `price_1TbEN0Jp0NUyqKK7mJUiTYTd`, yearly `price_1TcpJUJp0NUyqKK72qlMlLye`
- Cloudflare zone: `crawlmouse.com` (Active, on free plan)
- Cloudflare nameservers: `hans.ns.cloudflare.com` + `kim.ns.cloudflare.com`
- Domain registrar: Namecheap (NOT renewing PremiumDNS — turned off auto-renew)
- Sender email: `magic@crawlmouse.com` (Resend, verified domain)

---

## 8. Active operational watch-outs (carry-forward)

- **Stripe statement descriptor** may show "Nahl Techhnologies Inc" (double 'h') — verify before Stripe Live activation
- **Stripe co-founder team access** not yet set up
- **Legal pages** (`/privacy`, `/terms`, `/aup`) are placeholder text marked "replace before launch"
- **Node 22 required** — system default is v20; user must `nvm use` or `nvm install 22` in any new terminal before pnpm
- **Supabase CLI** must run from `infra/supabase/`, never repo root
- **Subagent push classifier** blocks `git push` to `main` from subagents — controller pushes after each subagent task
- **Live LinkGraph streaming**, **benchmark cohort cron**, **embed badge atomic counter**, etc. — all documented v1.1 deferrals in execution logs

---

## 9. Session-handoff checklist (NEW user does this)

1. [ ] Close current Claude Code session (Ctrl+D in terminal, or close the IDE pane)
2. [ ] Open new terminal in `/home/udsik/nahl-clients-projects/crawlmouse-v1.0.0`
3. [ ] Run `claude` (or however Claude Code is started)
4. [ ] In the new session, paste the **RESUME PROMPT** from §0 above
5. [ ] Verify the new session sees `handoff002.md` and reads it
6. [ ] Verify memory loaded (`MEMORY.md` should list 8 memories)
7. [ ] Proceed with §4 (Cloudflare Turnstile + Email Routing)

End of handoff 002.

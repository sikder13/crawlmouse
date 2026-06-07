# Crawlmouse v1.0 — Legal Documents: Research Synthesis & Decisions of Record

> Authored 2026-06-07 (Launch Session C, Stage 0 legal close-out). Backs the rewrite of
> `/privacy`, `/terms`, `/aup`, `/subprocessors` from "founder draft" to industry-standard, and the
> removal of the `DraftBanner`. Based on four parallel Opus research efforts (privacy-law
> requirements, SaaS ToS clauses, crawler-specific legal exposure, per-vendor DPA mechanics).
>
> **This is research-backed founder drafting, not attorney-reviewed advice.** A counsel pass is
> recommended post-launch; the items flagged "counsel" below are the highest-value review targets.

## Entity / governing law (confirmed by the operator)
- Legal entity: **Nahl Technologies Inc**, a **Delaware C-Corporation**, principal office in **Indiana, USA**, operator of Crawlmouse.
- Governing law: **Delaware**, plus exclusive venue in Delaware courts.

## Decisions of record (defensible defaults chosen from the research)
1. **No binding arbitration at launch.** Use informal-resolution-first → Delaware governing law + exclusive venue → jury-trial waiver → class-action waiver → 1-year contractual limitations period. Rationale: 2024–2025 mass-arbitration economics (AAA Mass Arbitration Supplementary Rules trigger at 25+ demands; ~$6M fee exposure before merits) make arbitration a *liability* for a low-ARPU consumer app. Revisit with counsel once volume justifies a modern mass-arb-protected arbitration clause. (Sources: Goodwin, Privacy World 2025 review, Axinn.)
2. **Eligibility 18+** to create an account / purchase (paid auto-renewing product → only adults should bind themselves). Privacy "children" floor stays **under 16** (GDPR Art. 8 default) with a **COPPA under-13** US reference.
3. **Liability cap = greater of (i) fees paid in the prior 12 months or (ii) USD $100**, with uncapped carve-outs for gross negligence, willful misconduct, and fraud. Rationale: the prior "12-month fees" cap collapses to **$0 for free/anonymous users** (most of the funnel) → illusory/unconscionable risk. (Sources: TermsFeed SaaS LoL, Galkin Law.)
4. **Warranty disclaimer rendered conspicuously** (ALL-CAPS), expressly naming MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT — UCC § 2-316 conspicuousness benchmark. (Source: Cornell LII UCC 2-316.)
5. **Remove the `DraftBanner`** — the docs are now the real, shipped policies.
6. **Do not assert an EU/UK Art. 27 representative** (none appointed yet). The policy provides a privacy contact + the Art. 77 supervisory-authority complaint right. Appointing an EU + UK rep is **recommended** (we likely don't qualify for the "occasional processing" exemption) but is an operator cost decision, flagged below — we do NOT bake a false claim into the policy.
7. **International transfers:** cite the **EU-US Data Privacy Framework (DPF)** for the 6 DPF-certified subprocessors and **EU SCCs + UK IDTA/Addendum** for the 2 that are not. (See vendor table.)
8. **Grades framed as opinion** based on a published, deterministic methodology — the real defamation/false-light protection (Section 230 likely does NOT cover Crawlmouse's *own* score). (Sources: Eric Goldman blog, FBM.)

## Subprocessor DPA + DPF + region matrix (verified June 2026)
| Vendor | DPA mechanism | Operator action | DPF-certified? | Transfer basis | Region |
|---|---|---|---|---|---|
| Stripe | Auto-incorporated (Stripe Services Agreement) | none | Yes | DPF | US / global |
| Resend | Auto-incorporated (Terms) | none | Yes | DPF | US (us-east-1) |
| Cloudflare | Auto-incorporated (Self-Serve Subscription Agreement) | none | Yes | DPF | Global edge |
| Vercel | Auto-incorporated (pre-signed) | none | Yes | DPF | US / global edge |
| Sentry (Functional Software Inc) | Click-to-accept in dashboard | **Accept DPA** (Settings → Legal & Compliance) | Yes | DPF | US |
| PostHog | Self-serve generator | **Generate + countersign** in-app | Yes | DPF | US (us.i.posthog.com) |
| Supabase | Request + e-sign (PandaDoc) | **Request + e-sign** (dashboard) | **No** | **SCCs** | US (us-east-1) |
| Inngest | No self-serve DPA found | **Email security@inngest.com** (lead time) | **No** | **SCCs** | US (AWS) |

`/subprocessors` region labels were verified accurate against vendor docs + our config. The DPF-vs-SCC
distinction lives in the Privacy Policy "International transfers" section (not the subprocessor table).

## Operator action checklist (NOT code; required/recommended before launch)
**Required:**
- Sign 4 DPAs: Supabase, PostHog, Sentry, Inngest (the other 4 auto-incorporate). Free; Inngest needs lead time.
- Register a **DMCA designated agent** with the U.S. Copyright Office ($6, renew every 3 years) — needed for the §512(c) safe harbor because we host owner-published public reports. (Source: copyright.gov/dmca-directory.)
- Verify each "DPF: Yes" vendor's status = Active at dataprivacyframework.gov/list (60-second check).

**Recommended (not launch-blocking):**
- Appoint EU + UK Art. 27 representatives (~$ hundreds/yr each).
- Add a geo-gated cookie-consent banner so PostHog analytics + error-replay do not fire for EU/UK visitors before opt-in (current setup loads analytics without a consent gate — a real, not just copy, gap).
- Annual ($190/yr) plan: send CA-ARL renewal-reminder emails (15–45 days pre-renewal) and ensure the Stripe portal offers same-medium click-to-cancel (ROSCA). Counsel: confirm checkout shows auto-renewal terms before billing info is collected.

## Crawler legal posture (why our design is defensible)
Public pages only · respects robots.txt · per-host concurrency caps + 429/503 backoff · self-identifying
User-Agent + `/bot` page · SSRF-blocks internal/loopback/non-HTTP · **stays logged-out / holds no accounts on
target sites** (the factor that won *Meta v. Bright Data*, N.D. Cal. 2024) · stores derived structure, not
verbatim page bodies. Law: *Van Buren v. United States* (2021) + *hiQ v. LinkedIn* (9th Cir. 2022) — crawling
public pages is not CFAA "unauthorized access"; the line is login-gated/access-restricted content + circumvention.
Risk is shifted to the user via a **crawl-authority representation + broad indemnity**; CNIL's €240K KASPR fine
(2024) shows EU scraping enforcement is real → minimize + short-retain + erasure route.

## Primary sources (abridged)
GDPR (gdpr-info.eu Arts. 6, 8, 12, 13, 22, 27, 32, 33, 34, 37, 77) · CCPA/CPRA (oag.ca.gov/privacy/ccpa) ·
EU-US DPF (dataprivacyframework.gov) · UK ICO international transfers (ico.org.uk) · ROSCA (15 U.S.C. §8403,
ftc.gov) · CA ARL / AB 2863 (leginfo.legislature.ca.gov) · FTC click-to-cancel vacatur (*Custom
Communications v. FTC*, 8th Cir. 2025) · UCC §2-316 (law.cornell.edu/ucc/2/2-316) · DMCA §512
(copyright.gov/512, copyright.gov/dmca-directory) · COPPA (ftc.gov COPPA FAQ) · *Van Buren v. United States*,
593 U.S. ___ (2021) · *hiQ Labs v. LinkedIn*, 31 F.4th 1180 (9th Cir. 2022) · *Meta v. Bright Data*, N.D.
Cal. 2024 · *Feist v. Rural Telephone*, 499 U.S. 340 (1991) · CNIL KASPR €240K (cnil.fr, 2024) ·
vendor DPAs: stripe.com/legal/dpa, resend.com/legal/dpa, cloudflare.com/cloudflare-customer-dpa,
vercel.com/legal/dpa, sentry.io/legal/dpa, posthog.com/dpa, supabase.com/legal/dpa, trust.inngest.com.

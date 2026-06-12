# Crawlmouse — SEO foundation + blog (design)

**Date:** 2026-06-12 · **Goal:** make crawlmouse.com discoverable and rank for its niche
(internal linking / site-structure auditing), and stand up a blog that earns evergreen organic
traffic. Built to current best practice; content written to read like a seasoned SEO practitioner.

## Current state (audited)
- ✅ Per-page `metadata` (title/description) on most pages; reasonable homepage title.
- ✅ `app/robots.ts` exists — but **malformed**: two separate `User-Agent: *` groups (one `allow`,
  one `disallow`), which crawlers treat inconsistently. No `sitemap` reference.
- ❌ No `app/sitemap.ts`.
- ❌ Zero structured data (no JSON-LD anywhere).
- ❌ No `metadataBase`, no default Open Graph / Twitter card, no icons at the app root → social
  shares render bare and OG/canonical URLs are not absolute.
- ❌ No blog.
- Decision of record: `/r/<slug>` public reports stay **noindex** (user-generated → thin/dup-content
  risk). SEO is driven by marketing pages + blog + `/top/[platform]` leaderboards. (`robots.ts`
  already disallows `/r/`, `/embed/`, `/audit/`, `/dashboard`, `/verify/`.)

## A. Technical SEO foundation
1. **`robots.ts`** — collapse to ONE `User-Agent: *` group: `allow: '/'` + `disallow` the private
   paths (unchanged set); add `sitemap: https://crawlmouse.com/sitemap.xml` + `host`.
2. **`app/sitemap.ts`** (new, dynamic) — emit every indexable URL from a single source of truth:
   marketing (`/`, `/pricing`, `/developers`, `/status`, `/bot`), legal (`/privacy`, `/terms`,
   `/aup`, `/subprocessors`), the blog index + every post, and the known `/top/[platform]` slugs.
   Per-URL `lastModified`, `changeFrequency`, `priority`. Absolute URLs from the canonical base.
3. **Root metadata** (`app/layout.tsx`) — add `metadataBase` (canonical base URL), a title template
   (`%s · Crawlmouse`), default `openGraph` (type/site_name/title/description/image) + Twitter
   `summary_large_image`, `icons`, and `alternates.canonical` support. Keyword-aware defaults.
4. **Default OG image** — a branded social card via `next/og` (`app/opengraph-image.tsx`) so any page
   without its own card still shares well. Plus `app/icon.tsx` (favicon).
5. **Structured data (JSON-LD)** — a small typed helper + `<script type="application/ld+json">`:
   - Site-wide (layout): `Organization` (name=Crawlmouse / Nahl Technologies Inc, url, logo).
   - Home: `WebSite` + `SearchAction` (sitelinks search box) + `SoftwareApplication` (free offer).
   - Home/pricing: `FAQPage` (3–5 real Q&As → FAQ rich results).
   - Blog posts: `Article` + `BreadcrumbList`.
6. **On-page polish** — keyword-tuned title/description + explicit canonical on home, `/pricing`,
   `/top/[platform]`, `/developers`.

## B. Blog
- **Architecture:** content as **typed TSX post modules** registered in a `posts` registry — no new
  heavy deps (no MDX tooling), full design-system control, easy JSON-LD. Each post module exports
  `meta` (slug, title, description, keywords, publishedAt, updatedAt, readingMinutes, ogImageAlt) +
  a `Body` component.
- **`/blog`** index — lists posts (title, excerpt, date, read time), SEO metadata, `Blog`/`ItemList`
  JSON-LD, links into each post.
- **`/blog/[slug]`** — renders a post via a shared `ArticleLayout` (typographic prose styles matching
  the site), `generateMetadata` per post (title/desc/canonical/OG), `Article` + `BreadcrumbList`
  JSON-LD, a breadcrumb, "related posts", and an "Audit your site free" CTA. `generateStaticParams`
  over the registry. Unknown slug → `notFound()`.
- **Nav/footer:** add a **Blog** link (footer; header if it fits) for crawl paths + discovery.

## C. Content (3 posts — internal-linking topic cluster, all interlinked + CTA to run an audit)
1. **`free-internal-link-audit`** — "How to Run a Free Internal-Link Audit (No Software to Install)".
   Keywords: internal link audit, internal link checker, free internal link audit. Bottom-funnel.
2. **`orphan-pages`** — "Orphan Pages: What They Are, Why They Hurt SEO, and How to Find Them".
   Keywords: orphan pages, orphan pages SEO, find orphan pages. Educational.
3. **`crawl-depth-site-architecture`** — "Crawl Depth & Site Architecture: Why Click-Depth Affects
   Rankings". Keywords: crawl depth, click depth SEO, site architecture. Educational.
- **Quality bar:** professional/human voice, clear H2/H3 structure, ~1,200–1,800 words, concrete
  examples + takeaways, researched against current best practice, natural (non-salesy) product
  mentions, accurate. Reviewed for authenticity (reads human, not AI), SEO soundness, and accuracy.

## D. Indexing
- Sitemap + robots wired (above).
- **IndexNow** — host the key file + ping Bing/Yandex on deploy (automatable; I set this up).
- **Google Search Console + Bing Webmaster** — operator-initiated (needs the Google/Microsoft login):
  verify the domain (DNS TXT — I can add it via the Cloudflare API once the token is pasted) and
  submit `sitemap.xml`. Exact steps handed to the operator.
- Note: indexing is enabled, not guaranteed/instant — Google decides crawl/index timing.

## Out of scope
- `/r/` report indexing (stays noindex — revisit post-traffic). No MDX tooling. No GSC account
  creation (operator identity). No paid link building.

## Testing / gate
- Source-reading + behavioral guards: robots single-group + sitemap ref; sitemap includes every
  marketing/legal/blog URL and excludes the disallowed paths; root metadata has metadataBase + OG +
  twitter + icons; each post has required SEO meta + Article JSON-LD + canonical; blog index lists
  all registered posts; unknown slug 404s. Then the project's TDD + 3×Opus gate; content gets an
  authenticity/SEO/accuracy review. Live verify after deploy (sitemap 200 + valid, rich-results
  test, OG preview).

# MEDIUM — a U+202E bidi override survives percent-decode into display text

**Status:** open · **Priority:** MEDIUM · **Owner ruling 2026-07-31:** open the ticket, do not fix now.
**Found by:** SPEC 05 hotfix-01 gate rounds 3 and 4 (security lens), reproduced in both.

## The defect

`safeDecodeUrlForDisplay` (`apps/web/lib/url-display.ts:13`) decodes percent-escapes for human-facing
display and performs **no bidi/control-character stripping**. Neither does anything else in the repo — a
search for bidi handling across the codebase returns nothing — so a crawled URL containing `%E2%80%AE`
decodes to a live **U+202E RIGHT-TO-LEFT OVERRIDE** and is rendered into the DOM as a text node.

Reproduced through the real helper and the real component:

```
input : https://ex.com/%E2%80%AEgnp.exe-txt/report
render: "This page is thin. · /‮gnp.exe-txt/report"
        ^ the override visually reverses the remainder, so it reads as …txt-exe.png
```

**This is not XSS.** The output is an inert, correctly HTML-escaped text node — verified: no `<script`, no
event-handler attribute, nothing reaching an `href`, `src`, style value, or `dangerouslySetInnerHTML`. The
harm is **visual spoofing**: a malicious path is displayed as a benign one, on surfaces a user reads to
decide whether a URL is trustworthy, including the permanent, world-readable `/r/` report.

## Why now

The class is **pre-existing** across all 11 decode modules (17 invocations). SPEC 05 hotfix-01 added one
new instance — the AI collapsed finding row (`apps/web/components/ai/ai-view-logic.ts`, via `displayPath`)
— which is what surfaced it. Crawled URLs are fully attacker-controlled: the crawler visits arbitrary
user-supplied sites, and any site owner can put an RLO in a path and get it rendered on our pages.

The existing guard matrix `apps/web/__tests__/spec04.2-url-decode-guard.test.tsx` covers RTL **script**
(Arabic, Hebrew) — which is legitimate content and must keep rendering — but not bidi **control
characters**, which are not. It also does not enumerate the AI surfaces at all; that second gap is FU-12h.

**Not a ReDoS amplification vector:** `AI_URL_MAX_BYTES = 500` bounds `targetUrl` at persistence, so the new
decode site is ~500 chars, well under where the super-linear cost in
`2026-07-31-url-display-superlinear-decode.md` becomes measurable.

## Fix sketch — fix the class, not the instance

1. Strip or neutralise bidi **formatting controls** in `safeDecodeUrlForDisplay` itself, so all 17
   invocations are covered by one change: U+202A–U+202E (embeddings + overrides), U+2066–U+2069 (isolates),
   U+061C (Arabic letter mark), U+200E/U+200F (LRM/RLM). Removing them is safer than substituting a
   visible marker for a URL path, where they have no legitimate use.
2. **Do not touch RTL script.** Arabic, Hebrew and Persian paths must continue to render normally — the
   guard matrix already pins that and must keep passing.
3. Consider wrapping rendered URL/anchor text in `<bdi>` (or `unicode-bidi: isolate`) as defence in depth,
   so neighbouring UI cannot be reordered even if a control slips through.
4. Extend the guard matrix with a bidi-control axis, and enumerate the AI surfaces while there (FU-12h).

## Related
`docs/tickets/2026-07-31-url-display-superlinear-decode.md` (same helper, same sweep — do both together) ·
FU-12h (AI body renders `targetUrl` undecoded and is absent from the guard matrix) ·
`apps/web/__tests__/spec04.2-url-decode-guard.test.tsx`

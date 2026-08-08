import { after } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { readLatestVisibleReport, badgeVerdict } from '@/lib/badge-report';
import { isPassingScore } from '@/lib/limits';
import { normalizeDomain } from '@/lib/domain';
import { htmlEscape } from '@/lib/html-escape';
import { siteUrl } from '@/lib/site-url';
import { BRAND } from '@/lib/brand';

export const runtime = 'nodejs';

// A Route Handler, not a page: the embed badge is a standalone document for a
// third-party <iframe>, so it must NOT be wrapped by the app's root <html>/<body>
// layout (a page returning its own <html> double-nests and breaks). It's also the
// hottest endpoint (rendered on every page-view of every site that embeds the
// badge), so it's CDN-cached; the view counter therefore increments per cache-miss
// (an approximate metric, by design — accuracy here isn't worth a DB write per
// third-party page view against the cost ceiling).
const CACHE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
  'x-robots-tag': 'noindex',
};

function htmlResponse(body: string, status = 200): Response {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{margin:0;padding:0;box-sizing:border-box;font-family:system-ui,sans-serif}body{background:transparent}</style></head><body>${body}</body></html>`, {
    status,
    headers: CACHE_HEADERS,
  });
}

function noReportBadge(domain: string): string {
  const run = htmlEscape(siteUrl(`/?url=${encodeURIComponent(`https://${domain}`)}`));
  return `<div style="padding:16px;color:${BRAND.ink}">No public Crawlmouse report yet for <strong>${htmlEscape(domain)}</strong>. <a href="${run}" target="_blank" rel="noreferrer" style="color:${BRAND.peach}">Run one &rarr;</a></div>`;
}

export async function GET(_req: Request, { params }: { params: Promise<{ domain: string }> }) {
  const { domain: rawDomain } = await params;

  let domain: string;
  try {
    domain = normalizeDomain(decodeURIComponent(rawDomain));
  } catch {
    return htmlResponse(noReportBadge(String(rawDomain).slice(0, 253)), 400);
  }
  if (!domain || domain.length > 253) {
    return htmlResponse(noReportBadge(domain || 'this domain'), 400);
  }

  const sb = supabaseAdmin();
  // Resolve the latest VISIBLE report for the domain — not taken down and not HIDDEN (§9). A hidden
  // report must not keep unfurling on a third party's badge; the helper is deploy-order-safe.
  const report = await readLatestVisibleReport(sb, domain);

  // SPEC 5.1a Stage 4 — a badge is a CLAIM, so with nothing to claim it refuses to mint and the
  // "not available" badge is served instead. badgeVerdict requires BOTH a letter and a score: the
  // previous `'—'` fallback would have rendered "Score — / 100" inside someone else's page, cached
  // for hours, which is a fabricated verdict on a surface we cannot correct.
  const verdict = badgeVerdict(report);
  if (!verdict) {
    return htmlResponse(noReportBadge(domain));
  }

  const grade = htmlEscape(verdict.grade);
  const score = verdict.score.toFixed(0);
  const passing = isPassingScore(verdict.score);
  const reportUrl = htmlEscape(siteUrl(`/r/${encodeURIComponent(verdict.slug)}`));

  // Approximate view count, incremented on the (cache-miss) render. Run it via
  // after() so it doesn't block the badge response yet still reliably reaches the DB
  // (a bare fire-and-forget can be dropped when the serverless function freezes).
  // Errors are swallowed so a counter hiccup never breaks the badge.
  after(async () => {
    try {
      await sb.rpc('increment_embed_view', { p_domain: domain });
    } catch {
      /* counter is best-effort; never surface */
    }
  });

  const badge = `<a href="${reportUrl}" target="_blank" rel="noreferrer" style="display:inline-flex;align-items:center;gap:10px;padding:10px 14px;background:${BRAND.cream};border:1px solid ${BRAND.oat};border-radius:12px;text-decoration:none;color:${BRAND.ink}">`
    + `<span style="font-weight:700;font-size:28px;color:${passing ? BRAND.sage : BRAND.peach};line-height:1">${grade}</span>`
    + `<span style="display:flex;flex-direction:column">`
    + `<span style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:${BRAND.inkMuted}">Crawlmouse</span>`
    + `<span style="font-size:13px;font-weight:500">Score ${score} / 100</span>`
    + `</span></a>`;

  return htmlResponse(badge);
}

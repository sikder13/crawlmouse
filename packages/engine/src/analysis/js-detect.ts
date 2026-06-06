import * as cheerio from 'cheerio';

/**
 * JS/SPA false-orphan floor (A4). The crawler uses CheerioCrawler, which reads STATIC
 * HTML only — it does not execute JavaScript. A client-rendered single-page app ships a
 * near-empty HTML shell and builds its links in the browser, so the static crawl sees few
 * or no links and falsely flags real pages as orphans. That is a trust-killer: the user
 * sees a flood of "orphan" findings on a site that is actually fine.
 *
 * This v1.0 FLOOR (no Playwright / no headless browser — that is a later upgrade) only
 * DETECTS the likely-SPA homepage so audit.ts can show an honest banner and SUPPRESS the
 * orphan scoring rather than emit misleading findings.
 *
 * The detector is deliberately CONSERVATIVE: a false positive wrongly suppresses real
 * orphan findings on a normal site, which is worse than missing a borderline SPA. Each
 * signal below is chosen to fire only on a genuinely content-empty shell.
 */

// CSS selectors for the well-known SPA mount nodes. An EMPTY one of these is the strongest
// SPA tell: the framework will fill it in the browser, but the static crawl sees a blank.
//  - #root        -> Create React App / Vite default
//  - #app         -> Vue CLI / many bundlers
//  - #__next      -> Next.js (client-only / non-SSR)
//  - [data-reactroot] -> legacy React hydration root
//  - #___gatsby   -> Gatsby
const SPA_ROOT_SELECTORS = ['#root', '#app', '#__next', '[data-reactroot]', '#___gatsby'];

// A noscript notice that explicitly tells the user JS is required. Matches the CRA default
// ("You need to enable JavaScript to run this app.") and common variants.
const NOSCRIPT_JS_NOTICE = /enable JavaScript|requires JavaScript|need.*JavaScript/i;

// WEAK-SHELL guardrails (branch (c) below). A blank client-render shell is told apart from a
// real-but-sparse static page by what SURVIVES once non-content markup is stripped: a shell
// collapses to (almost) nothing, while a real page still carries content elements (an image,
// heading, video, list, ...). Branch (c) additionally REQUIRES a script bundle — a page with no
// JavaScript at all cannot be client-rendered — so a CSS/SVG-heavy static splash, an image
// gallery, a video landing, or a script-free landing page can never trip it.
const MIN_LINKS_FOR_COMBO = 3;   // a real navigable page almost always has >= 3 links
const MAX_SHELL_TEXT = 64;       // a blank shell carries almost no inline text (e.g. "Loading…")
// Elements that constitute REAL rendered content. If any survives the strip below, the body is
// not a blank shell and branch (c) must not fire.
const CONTENT_SELECTOR =
  'img,picture,video,audio,iframe,canvas,object,embed,h1,h2,h3,h4,h5,h6,p,article,section,main,aside,nav,ul,ol,dl,table,form,figure,blockquote,pre,details';
// Non-content nodes stripped before judging emptiness, so heavy inline CSS/SVG cannot disguise a
// real page as empty (the false-positive the old text/markup ratio suffered).
const NON_CONTENT_SELECTOR = 'script, style, svg, noscript, template, link, br, hr';

export function looksJsRendered(html: string): boolean {
  const $ = cheerio.load(html);

  // (a) EMPTY SPA ROOT: a known mount node exists but has zero element children AND no
  // trimmed text. This is a blank shell waiting for the browser to render — the single
  // most reliable client-render signal.
  for (const sel of SPA_ROOT_SELECTORS) {
    const el = $(sel).first();
    if (el.length > 0 && el.children().length === 0 && el.text().trim() === '') {
      return true;
    }
  }

  // (b) NOSCRIPT-JS NOTICE: the page itself declares it needs JavaScript to run.
  let hasJsNotice = false;
  $('noscript').each((_, el) => {
    if (NOSCRIPT_JS_NOTICE.test($(el).text())) hasJsNotice = true;
  });
  if (hasJsNotice) return true;

  // (c) EMPTY SHELL WITH A RENDER BUNDLE: the page ships an external <script> bundle, has fewer
  // than a handful of links, and — once non-content markup (scripts, inline CSS/SVG, etc.) is
  // stripped — its body has NO real content elements and almost no text. That is the profile of a
  // client-rendered app whose mount node is not one of the well-known ids in (a). The two
  // affirmative requirements are what keep this OFF legitimate static pages: a script-free page
  // cannot be a SPA, and a page that still shows content (an image, heading, video, list, ...)
  // after its scripts/styles are removed is not a blank shell — so a CSS/SVG-heavy splash, an
  // image gallery, a video landing, or a sparse single-CTA page is never flagged here. (The old
  // text/markup ratio mis-flagged exactly those pages, because inline CSS inflated the denominator.)
  const hasAppBundle = $('script[src]').length > 0;
  if (hasAppBundle && $('a[href]').length < MIN_LINKS_FOR_COMBO) {
    const $body = $('body').clone();
    $body.find(NON_CONTENT_SELECTOR).remove();
    const hasContent = $body.find(CONTENT_SELECTOR).length > 0;
    const bodyText = $body.text().replace(/\s+/g, ' ').trim();
    if (!hasContent && bodyText.length < MAX_SHELL_TEXT) return true;
  }

  return false;
}

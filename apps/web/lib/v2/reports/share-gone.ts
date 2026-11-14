import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CrawlmouseMark } from '../../../components/icons/CrawlmouseMark';
import { SUPPORT_EMAIL } from '../../../components/v2/footer-links';

/**
 * The page a share link that no longer opens answers with (410), drawn as the v2 door's message
 * screens are (Check email, Continue): the app header with the brand, then a centred column with a
 * heading, one line and the support address. The route answers it as a plain response, which loads
 * no stylesheet and no next/font face, so the tokens it uses are written here and
 * `share-gone.test.ts` checks each against `styles/v2/tokens.css`; the typefaces fall back to the
 * stacks the tokens name after the next/font variable.
 */

/** The tokens the page uses, light then dark, as `styles/v2/tokens.css` declares them. */
export const GONE_TOKENS = {
  light: {
    '--v2-bg': '#f7f8fa',
    '--v2-fg': '#13161b',
    '--v2-fg2': '#3d4654',
    '--v2-line': '#e2e6eb',
    '--v2-brand': '#ff7849',
    '--v2-mark-line': '#1a1a18',
  },
  dark: {
    '--v2-bg': '#0f1317',
    '--v2-fg': '#e6e9ed',
    '--v2-fg2': '#b5bcc6',
    '--v2-line': '#242b33',
    '--v2-brand': '#ff7849',
    '--v2-mark-line': '#e6e9ed',
  },
} as const;

const declare = (tokens: Readonly<Record<string, string>>) =>
  Object.entries(tokens)
    .map(([name, value]) => `${name}:${value};`)
    .join('');

const DISPLAY = 'Charter, Georgia, serif';
const BODY = '-apple-system, BlinkMacSystemFont, sans-serif';

const STYLE = [
  `:root{${declare(GONE_TOKENS.light)}color-scheme:light}`,
  `@media (prefers-color-scheme: dark){:root{${declare(GONE_TOKENS.dark)}color-scheme:dark}}`,
  `body{margin:0;background:var(--v2-bg);color:var(--v2-fg);font-family:${BODY};font-size:16px;line-height:1.55;-webkit-font-smoothing:antialiased}`,
  // The app header: 64px, a hairline under it, the brand at the wrap's gutter (PageShell).
  `header{border-bottom:1px solid var(--v2-line)}`,
  `.bar{box-sizing:border-box;max-width:1160px;margin:0 auto;padding:0 40px;height:64px;display:flex;align-items:center}`,
  `.brand{display:flex;align-items:center;gap:10px;color:inherit;text-decoration:none}`,
  `.mark{display:block;flex:none}.mark line,.mark path{stroke:var(--v2-mark-line)}`,
  `.wordmark{font-family:${DISPLAY};font-weight:600;font-size:20px;letter-spacing:-0.025em;line-height:1}`,
  `.wordmark span{color:var(--v2-brand)}`,
  // The door's column (Door.module.css) and a Heading at size m (Heading.module.css).
  `main{box-sizing:border-box;max-width:1160px;margin:0 auto;padding:96px 40px 120px;display:flex;justify-content:center}`,
  `section{max-width:520px;width:100%}`,
  `h1{margin:0;font-family:${DISPLAY};font-weight:600;letter-spacing:-0.02em;font-size:26px;line-height:1.15}`,
  `p{margin:12px 0 0;color:var(--v2-fg2)}`,
  `a{color:inherit}main a{color:var(--v2-fg)}`,
  `@media (max-width:760px){.bar,main{padding-left:20px;padding-right:20px}main{padding-top:56px;padding-bottom:72px}h1{font-size:22px}}`,
].join('\n');

const MARK = renderToStaticMarkup(createElement(CrawlmouseMark, { size: 24, className: 'mark' }));

/** Static: nothing of the request or the link is in it. */
export const GONE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>This link no longer opens</title>
<style>
${STYLE}
</style>
</head>
<body>
<header><div class="bar"><a class="brand" href="/" aria-label="Crawlmouse home">${MARK}<span class="wordmark">crawl<span>mouse</span></span></a></div></header>
<main><section>
<h1>This link no longer opens</h1>
<p>It has expired or was withdrawn by the person who shared it. Ask them for a new link.</p>
<p>Something else: write to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
</section></main>
</body>
</html>
`;
